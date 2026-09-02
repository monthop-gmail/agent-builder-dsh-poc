import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { listToolNames, getTool } from "../builder/registry/tools.js";
import { decideCapabilities } from "../builder/registry/policy.js";
import { compileManifest } from "../builder/compiler.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { CAPABILITY_IDS, loadPlatformProfile } from "../builder/platform.js";

/**
 * The portable half of a ceiling — ADR-0026 rule 2.
 *
 * Rule 4 of the same ADR says a name-based `deny` protects only the namespace
 * that wrote it, which is why `profiles/coding-agent` denying
 * `github.pr.merge` never guarded our `github.merge`. A capability CAN cross
 * that line, because every registry answers to the same fourteen words — so
 * this is the mechanism that lets a platform ceiling govern a tool registry
 * the platform has never seen.
 */

const profile = (name: string) =>
  loadPlatformProfile(resolve(import.meta.dirname, "fixtures/platform", name));

function manifest(spec: Record<string, unknown> = {}): AgentManifest {
  const value = {
    apiVersion: "agent/v1alpha2",
    kind: "Agent",
    metadata: { name: "cap-ceiling", version: "0.1.0" },
    spec: {
      purpose: { primary: "test capability ceilings" },
      model: { preferred: ["deepseek"] },
      autonomy: { level: 3 },
      tools: { allowed: ["github.read", "web_search", "calculator"] },
      ...spec,
    },
  };
  const result = validateManifest(value);
  expect(result.errors, result.errors.join("; ")).toEqual([]);
  return value as AgentManifest;
}

describe("the registry declares what each tool runs on", () => {
  it("gives every tool capabilities drawn from capability/v1", () => {
    for (const name of listToolNames()) {
      const tool = getTool(name);
      expect(Array.isArray(tool.capabilities), `${name} declares no capabilities`).toBe(true);
      for (const c of tool.capabilities) {
        expect(CAPABILITY_IDS, `${name} claims '${c}', which is not in capability/v1`).toContain(c);
      }
    }
  });

  it("does not claim code_execution for the calculator", () => {
    // It evaluates a string validated down to digits and operators. Claiming
    // `code_execution` would make every ceiling that denies running code
    // withhold a calculator, which teaches people the ceiling is wrong.
    expect(getTool("calculator").capabilities).toEqual([]);
  });

  it("marks anything that leaves the process", () => {
    expect(getTool("web_search").capabilities).toContain("network_egress");
    expect(getTool("github.read").capabilities).toEqual(
      expect.arrayContaining(["github", "network_egress"]),
    );
  });
});

describe("a capability ceiling reaches tools it cannot name", () => {
  it("withholds every network tool when the profile denies network_egress", async () => {
    const base = await profile("narrow.profile.yaml");
    const platform = { ...base, denyCapabilities: ["network_egress"], toolsAllow: undefined };

    const built = compileManifest(manifest(), "sum", { platform });

    // The profile never mentioned `github.read` or `web_search` — it could
    // not have; it does not know this registry exists.
    expect(built.agent.tools.map((t) => t.name)).toEqual(["calculator"]);
    expect(built.droppedByCapability).toEqual([
      { tool: "github.read", capability: "network_egress" },
      { tool: "web_search", capability: "network_egress" },
    ]);
  });

  it("works from the agent's own side too", () => {
    const built = compileManifest(
      manifest({ policy: { forbidden: [], deniedCapabilities: ["github"] } }),
      "sum",
    );

    expect(built.agent.tools.map((t) => t.name).sort()).toEqual(["calculator", "web_search"]);
    expect(built.droppedByCapability).toEqual([{ tool: "github.read", capability: "github" }]);
  });

  it("reaches MCP tools that only exist after connecting", () => {
    // The case a named ceiling can never cover: nobody knows these names at
    // compile time, and everything behind MCP needs `mcp`.
    const decision = decideCapabilities({
      allowed: [
        {
          name: "collaboration.post_message",
          description: "late",
          effect: "write",
          capabilities: ["mcp"],
          parameters: {},
          execute: async () => ({ text: "" }),
        },
      ],
      forbidden: [],
      autonomy: { level: 3, allowedEffects: ["read", "write", "irreversible"] },
      humanApproval: [],
      deniedCapabilities: ["mcp"],
    });

    expect(decision.granted).toEqual([]);
    expect(decision.deniedByCapability).toEqual([
      { tool: "collaboration.post_message", capability: "mcp" },
    ]);
  });

  it("keeps a capability drop distinct from a name drop", () => {
    const built = compileManifest(
      manifest({ policy: { forbidden: ["calculator"], deniedCapabilities: ["github"] } }),
      "sum",
    );

    // Two different facts: someone named this tool, versus this tool needs
    // something nobody may use here. Only the second one travels.
    expect(built.droppedByPolicy).toEqual(["calculator"]);
    expect(built.droppedByCapability).toEqual([{ tool: "github.read", capability: "github" }]);
  });
});
