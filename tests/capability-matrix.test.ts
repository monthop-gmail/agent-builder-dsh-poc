import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderCapabilityMatrix } from "../scripts/emit-capability-matrix.js";

/**
 * The matrix is a table of facts that live in five adapters, and nothing
 * makes it wrong out loud when one of them changes. This repo shipped a
 * README claiming 45 tests while the suite ran 111, through nine merges —
 * so the document is generated, and this test is what says so.
 */

describe("docs/capability-matrix.md", () => {
  it("matches what the adapters report today", async () => {
    const path = resolve(import.meta.dirname, "../docs/capability-matrix.md");
    const onDisk = await readFile(path, "utf8");
    expect(
      onDisk,
      "capability matrix is stale — run `npm run docs:capabilities`",
    ).toBe(await renderCapabilityMatrix());
  });
});
