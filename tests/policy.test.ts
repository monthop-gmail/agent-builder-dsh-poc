import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";

const fixture = (name: string) => resolve(import.meta.dirname, "../manifests", name);

function compile(candidate: unknown) {
  const result = validateManifest(candidate);
  if (!result.ok) throw new Error(`fixture invalid: ${result.errors.join("; ")}`);
  return compileManifest(candidate as AgentManifest, "x".repeat(64));
}

function manifest(spec: Record<string, unknown>): unknown {
  return {
    apiVersion: "agent/v1alpha2",
    kind: "Agent",
    metadata: { name: "policy-fixture", version: "0.1.0" },
    spec: {
      purpose: { primary: "test" },
      model: { preferred: ["deepseek"] },
      autonomy: { level: 3 },
      ...spec,
    },
  };
}

describe("Policy is enforced by the Builder, not the runtime", () => {
  it("a forbidden tool never reaches the compiled agent", () => {
    const { agent, droppedByPolicy } = compile(
      manifest({
        tools: { allowed: ["calculator", "github.merge"] },
        policy: { forbidden: ["github.merge"] },
      }),
    );
    expect(agent.tools.map((t) => t.name)).toEqual(["calculator"]);
    expect(droppedByPolicy).toEqual(["github.merge"]);
  });

  it("tells the model the truth about what was withheld", () => {
    const { agent } = compile(
      manifest({
        tools: { allowed: ["calculator", "github.merge"] },
        policy: { forbidden: ["github.merge"] },
      }),
    );
    expect(agent.systemPrompt).toContain("github.merge");
    expect(agent.systemPrompt).toContain("cannot be called");
  });
});

describe("Autonomy level decides what needs a human", () => {
  it("level 1 gates a write tool but still grants it", () => {
    const { agent } = compile(
      manifest({
        autonomy: { level: 1 },
        tools: { allowed: ["github.read", "github.comment"] },
      }),
    );
    expect(agent.tools.map((t) => t.name)).toContain("github.comment");
    expect(agent.approvalRequired).toEqual(["github.comment"]);
  });

  it("level 3 gates nothing on its own", () => {
    const { agent } = compile(
      manifest({ autonomy: { level: 3 }, tools: { allowed: ["github.read", "github.comment"] } }),
    );
    expect(agent.approvalRequired).toEqual([]);
  });

  it("humanApproval gates a tool the autonomy level would have allowed", () => {
    const { agent } = compile(
      manifest({
        autonomy: { level: 3 },
        tools: { allowed: ["github.comment"] },
        humanApproval: { required: ["github.comment"] },
      }),
    );
    expect(agent.approvalRequired).toEqual(["github.comment"]);
  });
});

describe("The shipped code-reviewer manifest", () => {
  it("can read and comment, and has no path to merge", async () => {
    const loaded = await loadManifest(fixture("code-reviewer.yaml"));
    const { agent } = compile(loaded.value);
    const names = agent.tools.map((t) => t.name);
    expect(names).toEqual(["github.read", "github.comment"]);
    expect(names).not.toContain("github.merge");
    expect(agent.approvalRequired).toEqual(["github.comment"]);
    expect(agent.audit).toBe(true);
  });
});
