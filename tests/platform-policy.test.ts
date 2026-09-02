import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { compileManifest } from "../builder/compiler.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { admitLateTools } from "../builder/registry/policy.js";
import {
  AGENT_POLICY_FIELD_MAP,
  CANONICAL_SCOPE,
  CAPABILITY_IDS,
  PolicyBindingError,
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

    // The gap ADR-0022 warned about and agent-platform#52 has to close: the
    // ceiling changed what the agent can do, and the checksum did not move.
    const other = compileManifest(manifest(), "sum");
    expect(built.agent.manifestChecksum).toBe(other.agent.manifestChecksum);
    expect(built.agent.tools.length).not.toBe(other.agent.tools.length);
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

describe("the vendored profile — what actually happens today", () => {
  it("shares no tool vocabulary with our Tool Registry", async () => {
    const platform = await loadPlatformProfile(fixture("coding-agent.profile.yaml"));
    const built = compileManifest(manifest(), "sum", { platform });

    // Not a bug in the rules — a finding. `profiles/coding-agent` speaks
    // `tool/v1` ToolIds (`github.pr.merge`, `fs.file.read`) and this repo's
    // registry speaks its own names (`github.merge`). Under intersection that
    // means EVERY tool is dropped, and the agent still builds.
    //
    // Left visible on purpose: aligning the two vocabularies is real work
    // that has not been done, and a test that quietly passed would hide it.
    expect(built.agent.tools).toEqual([]);
    expect(built.droppedByCeiling.sort()).toEqual([
      "github.comment",
      "github.merge",
      "github.read",
    ]);

    // The one thing that DOES line up is the rule itself: their profile denies
    // merging with the comment "merge เป็นของคน ไม่ใช่ของ agent", and our
    // example manifest forbids the same act under a different name.
    expect(platform.toolsDeny).toContain("github.pr.merge");
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
