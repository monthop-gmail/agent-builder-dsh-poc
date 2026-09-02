import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";
import { packageAgent } from "../builder/packager.js";
import { listRuntimeIds } from "../builder/registry/runtimes.js";

/**
 * THE test. Everything else in this repo exists to make this one pass
 * honestly.
 *
 * It builds ONE manifest for EVERY registered target and asserts the agent
 * came out identical. Note there is no `--target mock` overriding a manifest
 * that already said mock — that would only prove mock equals mock. The
 * manifest names no runtime at all, so each build is a genuinely different
 * target.
 */

const fixture = (name: string) => resolve(import.meta.dirname, "../manifests", name);
const EXAMPLES = ["researcher.yaml", "code-reviewer.yaml", "coding-agent.yaml"];

async function buildFor(manifestPath: string, target: string) {
  const loaded = await loadManifest(manifestPath);
  const result = validateManifest(loaded.value);
  if (!result.ok) throw new Error(`${manifestPath}: ${result.errors.join("; ")}`);
  const { agent } = compileManifest(loaded.value as AgentManifest, loaded.checksum);
  return packageAgent(agent, target);
}

describe("Portability — one manifest, every target", () => {
  it("has more than one target, or the claim is untestable", () => {
    expect(listRuntimeIds().length).toBeGreaterThan(1);
  });

  for (const example of EXAMPLES) {
    it(`${example} builds identically for [${listRuntimeIds().join(", ")}]`, async () => {
      const targets = listRuntimeIds();
      const packages = await Promise.all(targets.map((t) => buildFor(fixture(example), t)));

      const [first, ...rest] = packages;
      if (!first) throw new Error("no targets");

      for (const pkg of rest) {
        // the manifest itself was never touched
        expect(pkg.manifestChecksum).toBe(first.manifestChecksum);
        // and it compiled to the same agent
        expect(pkg.agent).toEqual(first.agent);
        expect(pkg.systemPrompt).toBe(first.systemPrompt);
        expect(pkg.capabilities).toEqual(first.capabilities);
        expect(pkg.governance).toEqual(first.governance);
        // only the target differs
        expect(pkg.target).not.toBe(first.target);
      }
    });
  }

  it("no compiled agent leaks a runtime-specific field", async () => {
    for (const example of EXAMPLES) {
      const pkg = await buildFor(fixture(example), "mock");
      const json = JSON.stringify(pkg.agent) + JSON.stringify(pkg.capabilities);
      expect(json.toLowerCase()).not.toContain("dsh");
      expect(json.toLowerCase()).not.toContain("deepseek-harness");
    }
  });
});
