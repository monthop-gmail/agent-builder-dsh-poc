import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  BUILTIN_NAMESPACE,
  ToolIdCollisionError,
  isToolId,
  toolIdFor,
  toolIdMap,
} from "../builder/tool-ids.js";
import { listToolNames } from "../builder/registry/tools.js";
import { compileManifest } from "../builder/compiler.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { loadPlatformProfile } from "../builder/platform.js";
import { indexByWireName } from "../builder/tool-names.js";

/**
 * The chain the whole conformance milestone rests on:
 *
 *   internal name → wire ToolId → capability → policy → CompiledAgent → runtime
 *
 * `agent-platform` #59 option A says the name a manifest writes and the name
 * that crosses a contract boundary need not be the same string. That is only
 * safe if the mapping is tested — otherwise it is a convention, and a
 * convention is what the last four ADRs were all written to replace.
 */

const profile = (name: string) =>
  loadPlatformProfile(resolve(import.meta.dirname, "fixtures/platform", name));

function manifest(spec: Record<string, unknown> = {}): AgentManifest {
  const value = {
    apiVersion: "agent/v1alpha2",
    kind: "Agent",
    metadata: { name: "tool-identity", version: "0.1.0" },
    spec: {
      purpose: { primary: "walk the identity chain" },
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

describe("internal name → wire ToolId", () => {
  it("maps every registry tool to something tool/v1 accepts", () => {
    for (const [name, id] of toolIdMap(listToolNames())) {
      expect(isToolId(id), `${name} → ${id}`).toBe(true);
    }
  });

  it("leaves an already-valid id alone", () => {
    // `github.read` is legal as it stands. Rewriting it to
    // `builder.github_read` would throw away the alignment with the
    // ecosystem's own `github.*` namespace for no gain.
    expect(toolIdFor("github.read")).toBe("github.read");
  });

  it("gives a bare name a domain, not an owner", () => {
    // `tool/v1`: "ส่วนแรกคือ domain ส่วนท้ายคือ action". `builder.web_search`
    // would satisfy the pattern and say nothing.
    expect(toolIdFor("web_search")).toBe("web.search");
    expect(toolIdFor("calculator")).toBe("math.evaluate");
    expect(toolIdFor("current_time")).toBe("time.now");
  });

  it("sanitises the character sets real MCP servers actually use", () => {
    // Probed for #59: Canva ships `kebab-case`, Composio ships
    // `SCREAMING_SNAKE`. Neither passes `[a-z][a-z0-9_]*` however it is
    // namespaced, so prefixing alone was never going to be enough.
    expect(toolIdFor("canva.comment-on-design")).toBe("canva.comment_on_design");
    expect(toolIdFor("composio.COMPOSIO_SEARCH_TOOLS")).toBe("composio.composio_search_tools");
    expect(toolIdFor("weird-name")).toBe(`${BUILTIN_NAMESPACE}.weird_name`);
  });

  it("refuses a collision rather than letting one tool win", () => {
    // The collision comes from OUR sanitising, not from the server. Letting
    // one win would put two different tools behind one id, and a policy
    // written about one would silently govern the other.
    expect(() => toolIdMap(["canva.list-comments", "canva.list_comments"])).toThrow(
      ToolIdCollisionError,
    );
  });
});

describe("the wire id is not the model-facing name either", () => {
  it("keeps the two mappings separate", () => {
    // `tool-names.ts` sanitises for the MODEL (function-call names cannot
    // contain dots); `tool-ids.ts` sanitises for the PLATFORM. They answer to
    // different rules and must not be collapsed into one.
    const wire = indexByWireName([
      { name: "github.read" },
      { name: "current_time" },
    ] as never);

    expect([...wire.keys()]).toContain("github_read");   // model sees this
    expect(toolIdFor("github.read")).toBe("github.read"); // platform sees this
  });
});

describe("ceiling applied in ToolId space", () => {
  it("matches a profile written in ToolIds against internal names", async () => {
    const platform = await profile("narrow.profile.yaml");
    const built = compileManifest(manifest(), "sum", { platform });

    // The profile allows `time.now`; the registry calls it `current_time`.
    // Comparing the raw strings would have dropped it as "not allowed".
    expect(platform.toolsAllow).toContain("time.now");
    expect(built.agent.tools.map((t) => t.name).sort()).toEqual(["github.comment", "github.read"]);
    expect(built.droppedByCeiling).toEqual(["github.merge"]);
  });

  it("still rejects a profile from a genuinely different namespace", async () => {
    const platform = await profile("coding-agent.profile.yaml");

    // `github.issue.read` and `github.read` are different tools, not the same
    // tool spelled differently — mapping cannot and must not paper over that.
    expect(() => compileManifest(manifest(), "sum", { platform })).toThrow();
  });

  it("carries a profile deny through to the compiled agent", async () => {
    const platform = await profile("narrow.profile.yaml");
    const built = compileManifest(manifest(), "sum", { platform });

    // Written `github.merge` in the profile, applied against the internal
    // name of the same tool.
    expect(built.agent.policy.forbidden).toContain("github.merge");
    expect(built.agent.tools.map((t) => t.name)).not.toContain("github.merge");
  });
});

describe("the whole chain, end to end", () => {
  it("goes internal → wire id → capability → policy → CompiledAgent", async () => {
    const platform = await profile("narrow.profile.yaml");
    const built = compileManifest(
      manifest({ tools: { allowed: ["github.read", "web_search"] } }),
      "sum",
      {
        platform: {
          ...platform,
          denyCapabilities: ["github"],
          toolsAllow: undefined,
          // The fixture REQUIRES `github`; denying it would be rejected as an
          // invalid binding before any of this ran, which is its own test.
          requiredCapabilities: [],
        },
      },
    );

    // `github.read` declares `github` + `network_egress`; the ceiling denies
    // `github`, so it goes — under a capability the profile named without ever
    // naming the tool.
    expect(built.droppedByCapability).toEqual([{ tool: "github.read", capability: "github" }]);
    // `web_search` needs only `network_egress`, which nothing denied here.
    expect(built.agent.tools.map((t) => t.name)).toEqual(["web_search"]);
    // ...and the id that would cross the contract boundary is the wire one,
    // which is NOT the internal name for this tool.
    expect(toolIdFor("web_search")).toBe("web.search");
    // ...while identity covers the policy that produced this set.
    expect(built.agent.buildIdentity).toMatch(/^[0-9a-f]{64}$/);
  });
});
