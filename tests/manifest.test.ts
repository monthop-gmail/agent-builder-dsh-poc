import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadManifest } from "../builder/loader.js";
import { validateManifest } from "../builder/validator.js";

const fixture = (name: string) => resolve(import.meta.dirname, "../manifests", name);

function valid(spec: Record<string, unknown> = {}): unknown {
  return {
    apiVersion: "agent/v1alpha2",
    kind: "Agent",
    metadata: { name: "test-agent", version: "0.1.0" },
    spec: {
      purpose: { primary: "test" },
      model: { preferred: ["deepseek"] },
      autonomy: { level: 1 },
      tools: { allowed: ["calculator"] },
      ...spec,
    },
  };
}

describe("Loader", () => {
  it("parses YAML and reports a stable checksum", async () => {
    const a = await loadManifest(fixture("researcher.yaml"));
    const b = await loadManifest(fixture("researcher.yaml"));
    expect((a.value as { apiVersion: string }).apiVersion).toBe("agent/v1alpha2");
    expect(a.checksum).toBe(b.checksum);
    expect(a.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Validator — agent/v1alpha2 contract", () => {
  it("accepts every shipped example", async () => {
    for (const name of ["researcher.yaml", "code-reviewer.yaml", "coding-agent.yaml"]) {
      const loaded = await loadManifest(fixture(name));
      const result = validateManifest(loaded.value);
      expect(result.errors, `${name}: ${result.errors.join("; ")}`).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it("rejects the wrong apiVersion", () => {
    const result = validateManifest({ ...(valid() as object), apiVersion: "agent/v1" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("apiVersion"))).toBe(true);
  });

  it("rejects a runtime-specific field anywhere in the manifest", () => {
    const result = validateManifest(valid({ dshAgentCore: { secret: 1 } }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("dshAgentCore"))).toBe(true);
  });

  it("rejects spec.runtime and explains that a runtime is a build target", () => {
    const result = validateManifest(valid({ runtime: { type: "dsh" } }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("--target"))).toBe(true);
  });

  it("rejects an unknown tool, skill, or MCP server", () => {
    const r1 = validateManifest(valid({ tools: { allowed: ["no_such_tool"] } }));
    expect(r1.errors.some((e) => e.includes("no_such_tool"))).toBe(true);

    const r2 = validateManifest(valid({ skills: ["nope"] }));
    expect(r2.errors.some((e) => e.includes("Skill Registry"))).toBe(true);

    const r3 = validateManifest(valid({ mcp: { servers: ["nope"] } }));
    expect(r3.errors.some((e) => e.includes("MCP Registry"))).toBe(true);
  });

  it("rejects an undefined autonomy level", () => {
    const result = validateManifest(valid({ autonomy: { level: 9 } }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("autonomy.level"))).toBe(true);
  });

  it("rejects a non-semver version", () => {
    const bad = valid() as { metadata: { version: string } };
    bad.metadata.version = "v1";
    expect(validateManifest(bad).ok).toBe(false);
  });

  it("warns when a forbidden name matches no tool, because it protects nothing", () => {
    const result = validateManifest(valid({ policy: { forbidden: ["github.delete_everything"] } }));
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("protects nothing"))).toBe(true);
  });
});
