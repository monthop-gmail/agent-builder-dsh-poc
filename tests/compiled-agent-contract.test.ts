import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";

/**
 * Keeps the CompiledAgent contract document honest about its own fields.
 *
 * The prose in that file is reasoning, which does not rot. The field table
 * is a list of facts that lives in `builder/types.ts`, which does — so the
 * table is checked against a real CompiledAgent rather than trusted.
 */

describe("docs/compiled-agent-contract.md", () => {
  it("documents exactly the fields a CompiledAgent has", async () => {
    const probe = resolve(import.meta.dirname, "fixtures/capability-probe.yaml");
    const loaded = await loadManifest(probe);
    const result = validateManifest(loaded.value);
    if (!result.ok) throw new Error(result.errors.join("; "));
    const agent = compileManifest(loaded.value as AgentManifest, loaded.checksum).agent;

    const doc = await readFile(
      resolve(import.meta.dirname, "../docs/compiled-agent-contract.md"),
      "utf8",
    );
    // Field rows open with a single backticked identifier in the first cell.
    const documented = [...doc.matchAll(/^\| `([a-zA-Z]+)` \|/gm)].map((m) => m[1] as string);

    expect(documented.toSorted(), "docs/compiled-agent-contract.md field table is out of date").toEqual(
      Object.keys(agent).toSorted(),
    );
  });
});
