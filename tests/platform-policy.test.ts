import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { compileManifest } from "../builder/compiler.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { admitLateTools } from "../builder/registry/policy.js";
import { resetCatalog, setCatalogForTest } from "../builder/registry/models.js";
import {
  AGENT_POLICY_FIELD_MAP,
  CANONICAL_SCOPE,
  CAPABILITY_IDS,
  PolicyBindingError,
  ProfileNamespaceError,
  combinePolicies,
  loadPlatformProfile,
  type AgentPolicyView,
} from "../builder/platform.js";

/**
 * ADR-0022 states the three-party rule and then says outright that neither
 * JSON Schema nor the platform's drift check can enforce it:
 *
 *   > กฎการรวม (intersection/union) และกฎ required ∩ deny = ∅
 *   > พิสูจน์ได้จากเทสของ consumer ที่รันจริงเท่านั้น
 *
 * So this file is not "tests for a helper". It is the only place in the
 * ecosystem where that rule is currently proven at all.
 */

const fixture = (name: string) => resolve(import.meta.dirname, "fixtures/platform", name);
const narrow = () => loadPlatformProfile(fixture("narrow.profile.yaml"));

function manifest(spec: Record<string, unknown> = {}): AgentManifest {
  const value = {
    apiVersion: "agent/v1alpha2",
    kind: "Agent",
    metadata: { name: "ceiling-test", version: "0.1.0" },
    spec: {
      purpose: { primary: "test the three-party rule" },
      model: { preferred: ["deepseek"] },
      autonomy: { level: 3 },
      tools: { allowed: ["github.read", "github.comment", "github.merge"] },
      ...spec,
    },
  };
  const result = validateManifest(value);
  expect(result.errors, result.errors.join("; ")).toEqual([]);
  return value as AgentManifest;
}

const names = (r: ReturnType<typeof compileManifest>) => r.agent.tools.map((t) => t.name).sort();

describe("allow — intersection", () => {
  it("drops what the manifest asked for but the ceiling never granted", async () => {
    const built = compileManifest(manifest(), "sum", { platform: await narrow() });

    // `github.merge` IS in the manifest's allowed list. It is not in the
    // profile's, so asking cannot produce it.
    expect(built.droppedByCeiling).toEqual(["github.merge"]);
    expect(names(built)).not.toContain("github.merge");
  });

  it("does not hand over a ceiling-allowed tool the manifest never asked for", async () => {
    const built = compileManifest(
      manifest({ tools: { allowed: ["github.read"] } }),
      "sum",
      { platform: await narrow() },
    );

    // The profile allows `current_time`; this agent did not ask. Widening is
    // impossible in BOTH directions, which is the half of "intersection" that
    // is easy to implement backwards.
    expect(names(built)).toEqual(["github.read"]);
  });

  it("changes nothing when no ceiling is supplied", async () => {
    const withoutCeiling = compileManifest(manifest(), "sum");
    expect(names(withoutCeiling)).toEqual(["github.comment", "github.merge", "github.read"]);
    expect(withoutCeiling.droppedByCeiling).toEqual([]);
    expect(withoutCeiling.agent.policySource).toBeUndefined();
  });
});

describe("deny — union, from either side", () => {
  it("honours a deny that only the platform stated", async () => {
    const built = compileManifest(manifest(), "sum", { platform: await narrow() });
    expect(built.agent.policy.forbidden).toContain("github.merge");
    expect(built.agent.policy.deniedCapabilities).toEqual(["shell"]);
  });

  it("honours a deny that only the agent stated", async () => {
    const built = compileManifest(
      manifest({ policy: { forbidden: ["github.comment"] } }),
      "sum",
      { platform: await narrow() },
    );

    expect(built.agent.policy.forbidden).toEqual(["github.comment", "github.merge"]);
    expect(built.droppedByPolicy).toEqual(["github.comment"]);
    expect(names(built)).toEqual(["github.read"]);
  });

  it("unions require_human_for from both sides", async () => {
    const built = compileManifest(
      manifest({
        autonomy: { level: 3 },
        humanApproval: { required: ["github.read"] },
      }),
      "sum",
      { platform: await narrow() },
    );

    // `github.comment` comes from the profile, `github.read` from the manifest.
    expect(built.agent.approvalRequired.sort()).toEqual(["github.comment", "github.read"]);
  });

  it("keeps a ceiling-denied tool unreachable when it arrives late from MCP", async () => {
    const built = compileManifest(manifest(), "sum", { platform: await narrow() });

    // MCP servers only announce their tools once connected, so this is the
    // one door compile time cannot see through. It has to be shut by the
    // EFFECTIVE policy, not by the manifest's half of it.
    const late = admitLateTools(built.agent, [
      { name: "github.merge", description: "late", effect: "irreversible", parameters: {}, run: async () => "" },
    ] as never);

    expect(late.granted).toEqual([]);
    expect(late.forbidden).toEqual(["github.merge"]);
  });
});

describe("required ∩ deny = ∅ — reject, do not narrow", () => {
  it("refuses to compile when the agent needs what the ceiling denies", async () => {
    const platform = await narrow();
    const conflicting = { ...platform, requiredCapabilities: ["shell", "github"] };

    // The profile requires `shell` while denying it — self-contradictory, and
    // the point is that we stop rather than emit a quietly smaller agent.
    expect(() => compileManifest(manifest(), "sum", { platform: conflicting })).toThrow(
      PolicyBindingError,
    );

    try {
      compileManifest(manifest(), "sum", { platform: conflicting });
    } catch (error) {
      expect((error as PolicyBindingError).conflicts).toEqual(["shell"]);
      expect((error as Error).message).toContain("does not run");
    }
  });

  it("refuses when the AGENT needs what the ceiling denies", async () => {
    const platform = await narrow();     // denies `shell`
    const needsShell = manifest({ capabilities: { required: ["shell", "github"] } });

    // Until `spec.capabilities` existed this rule could only fire from the
    // profile's side, so an agent could declare no needs at all and slip
    // under any ceiling. Now both parties are in the union ADR-0022 describes.
    expect(() => compileManifest(needsShell, "sum", { platform })).toThrow(PolicyBindingError);

    try {
      compileManifest(needsShell, "sum", { platform });
    } catch (error) {
      expect((error as PolicyBindingError).conflicts).toEqual(["shell"]);
    }
  });

  describe("with a catalog that declares what its models can do", () => {
    // The offline seed declares nothing on purpose, so a required capability
    // cannot be satisfied by it at all. That is the correct default and is
    // covered in `tests/model-capabilities.test.ts`; here we only need a
    // catalog that can say yes.
    beforeAll(() => {
      setCatalogForTest({
        deepseek: {
          id: "deepseek-chat",
          directBaseUrl: "https://api.deepseek.com/v1",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          capabilities: ["tool_calling", "github", "long_context"],
        },
      });
    });
    afterAll(resetCatalog);

    it("compiles when the agent's needs sit inside the ceiling", async () => {
      const platform = await narrow();
      const fine = manifest({
        capabilities: { required: ["github"], preferred: ["long_context"] },
      });
      expect(() => compileManifest(fine, "sum", { platform })).not.toThrow();
    });
  });

  it("rejects a manifest that requires what it forbids itself", () => {
    const result = validateManifest({
      apiVersion: "agent/v1alpha2",
      kind: "Agent",
      metadata: { name: "self-contradicting", version: "0.1.0" },
      spec: {
        purpose: { primary: "x" },
        model: { preferred: ["deepseek"] },
        autonomy: { level: 1 },
        tools: { allowed: ["github.read"] },
        capabilities: { required: ["shell"] },
        policy: { forbidden: [], deniedCapabilities: ["shell"] },
      },
    });

    // No profile involved — the agent contradicts itself, and the message
    // should say so rather than blaming whatever ceiling it is bound to later.
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("cannot require what it forbids itself"))).toBe(true);
  });

  it("refuses a required capability the taxonomy has never heard of", () => {
    const result = validateManifest({
      apiVersion: "agent/v1alpha2",
      kind: "Agent",
      metadata: { name: "unknown-need", version: "0.1.0" },
      spec: {
        purpose: { primary: "x" },
        model: { preferred: ["deepseek"] },
        autonomy: { level: 1 },
        tools: { allowed: ["github.read"] },
        capabilities: { required: ["telepathy"] },
      },
    });

    // ADR-0009: unknown capability = absent. A requirement nothing can ever
    // satisfy is an error, unlike a DENIAL of something unknown, which merely
    // protects nothing and gets a warning.
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("counts as absent"))).toBe(true);
  });

  it("compiles when required and denied do not overlap", async () => {
    const platform = await narrow();
    expect(platform.requiredCapabilities).toEqual(["github"]);
    expect(platform.denyCapabilities).toEqual(["shell"]);
    expect(() => compileManifest(manifest(), "sum", { platform })).not.toThrow();
  });
});

describe("provenance", () => {
  it("records which profile shaped the policy, without claiming it is identity", async () => {
    const platform = await narrow();
    const built = compileManifest(manifest(), "sum", { platform });

    expect(built.agent.policySource).toEqual({
      profileId: "narrow-reviewer",
      profileChecksum: platform.checksum,
    });

    // The gap ADR-0022 warned about, now closed by ADR-0025: the ceiling
    // changes what the agent can do, so it has to change what the agent IS.
    // `manifestChecksum` still cannot see it — that is correct, it answers a
    // different question — and `buildIdentity` must.
    const other = compileManifest(manifest(), "sum");
    expect(built.agent.manifestChecksum).toBe(other.agent.manifestChecksum);
    expect(built.agent.buildIdentity).not.toBe(other.agent.buildIdentity);
  });
});

describe("capability/v1 v1.1.0", () => {
  it("carries the taxonomy the platform published, including tool_calling", () => {
    expect(CANONICAL_SCOPE.provider).toContain("tool_calling");
    expect(CAPABILITY_IDS).toHaveLength(14);
    // Every id sits in exactly one scope — ADR-0024's whole point, and the
    // thing their drift check 4b enforces upstream.
    expect(new Set(CAPABILITY_IDS).size).toBe(CAPABILITY_IDS.length);
  });

  it("warns rather than fails when a manifest denies an unknown capability", () => {
    const result = validateManifest({
      apiVersion: "agent/v1alpha2",
      kind: "Agent",
      metadata: { name: "unknown-cap", version: "0.1.0" },
      spec: {
        purpose: { primary: "x" },
        model: { preferred: ["deepseek"] },
        autonomy: { level: 1 },
        tools: { allowed: ["github.read"] },
        policy: { forbidden: [], deniedCapabilities: ["telepathy"] },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("denies nothing"))).toBe(true);
  });
});

describe("a ceiling from the wrong namespace — ADR-0026 rule 3", () => {
  it("rejects the binding instead of compiling an agent with no tools", async () => {
    const platform = await loadPlatformProfile(fixture("coding-agent.profile.yaml"));

    // `profiles/coding-agent` speaks `tool/v1` ToolIds (`github.pr.merge`,
    // `fs.file.read`); this repo's registry speaks its own (`github.merge`).
    // Until 2026-09-03 this compiled to an agent with zero tools and said
    // nothing. ADR-0026 rule 3 made that a rejection, and gave the reason:
    // a silent deny-all is indistinguishable from a ceiling doing its job.
    expect(() => compileManifest(manifest(), "sum", { platform })).toThrow(
      ProfileNamespaceError,
    );

    try {
      compileManifest(manifest(), "sum", { platform });
    } catch (error) {
      expect((error as Error).message).toContain("different tool ids");
      expect((error as ProfileNamespaceError).ceiling).toContain("github.issue.read");
      expect((error as ProfileNamespaceError).requested).toContain("github.merge");
    }
  });

  it("still honours a ceiling that deliberately allows nothing", async () => {
    const platform = await narrow();

    // Rule 1: `tools.allow: []` is a real ceiling granting nothing, and is a
    // different statement from having no allowlist. It must NOT be mistaken
    // for the namespace mistake above.
    const built = compileManifest(manifest(), "sum", { platform: { ...platform, toolsAllow: [] } });
    expect(built.agent.tools).toEqual([]);
    expect(built.droppedByCeiling.length).toBeGreaterThan(0);
  });

  it("does not reject when the agent asked for no tools at all", async () => {
    const platform = await loadPlatformProfile(fixture("coding-agent.profile.yaml"));
    const toolless = manifest({ tools: undefined, mcp: { servers: ["filesystem"] } });

    // No request, no evidence of a mismatch. Rejecting here would punish a
    // manifest for something it never said.
    let built!: ReturnType<typeof compileManifest>;
    expect(() => (built = compileManifest(toolless, "sum", { platform }))).not.toThrow();

    // And the ceiling must not have GRANTED anything either — a profile is a
    // ceiling, not a permission. Handing over `tools.allow` here would give
    // the agent nine tools its manifest never mentions.
    expect(built.agent.tools).toEqual([]);
  });

  it("names the same act under two vocabularies — which is the point", async () => {
    const platform = await loadPlatformProfile(fixture("coding-agent.profile.yaml"));

    // Their profile denies merging with the comment "merge เป็นของคน ไม่ใช่
    // ของ agent"; our example manifest forbids the same act under a different
    // name. The rule matched long before the vocabulary did — and ADR-0026
    // rule 4 is precisely that a named deny protects only the namespace it
    // names, so `github.pr.merge` never guarded our `github.merge`.
    expect(platform.toolsDeny).toContain("github.pr.merge");
    expect(platform.toolsDeny).not.toContain("github.merge");
  });
});

describe("the mapping table", () => {
  it("says the same thing as docs/effective-policy.md", async () => {
    const { readFile } = await import("node:fs/promises");
    const doc = await readFile(
      resolve(import.meta.dirname, "../docs/effective-policy.md"),
      "utf8",
    );

    for (const row of AGENT_POLICY_FIELD_MAP) {
      expect(doc, `docs/effective-policy.md is missing ${row.ours}`).toContain(row.ours);
      expect(doc, `docs/effective-policy.md is missing ${row.theirs}`).toContain(row.theirs);
    }
  });
});

describe("combinePolicies — the shape, without a compiler around it", () => {
  const agent: AgentPolicyView = {
    denyTools: ["b"],
    denyCapabilities: ["shell"],
    requireHumanFor: ["x"],
    toolsRequested: ["one", "two"],
    requiredCapabilities: [],
  };

  it("treats an absent allowlist and an empty one as different things", async () => {
    const platform = await narrow();

    const noList = combinePolicies(agent, { ...platform, toolsAllow: undefined });
    expect(noList.toolsAllow).toEqual(["one", "two"]);

    // `profiles/README.md`: "`tools.allow` ว่าง = ไม่อนุญาต tool ใดเลย".
    const emptyList = combinePolicies(agent, { ...platform, toolsAllow: [] });
    expect(emptyList.toolsAllow).toEqual([]);
    expect(emptyList.droppedByCeiling).toEqual(["one", "two"]);
  });
});
