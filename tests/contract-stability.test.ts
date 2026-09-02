import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderBaseline, type Baseline } from "../scripts/emit-compatibility-baseline.js";

/**
 * The contract is behavioural: a manifest that was valid stays valid, and a
 * manifest that built stays buildable, unless the contract version changes on
 * purpose.
 *
 * That cannot be checked by looking at TypeScript. An added validation rule,
 * a stricter default, or a new blocking `unsupported()` case can turn a valid
 * manifest into a rejected one without any signature moving — so the check is
 * against recorded behaviour instead.
 *
 * When this fails, one of two things happened, and they need different
 * answers:
 *
 *   a change that was not meant to break anything did       → fix the change
 *   the contract genuinely moved                            → bump the
 *     contract version, say why, then `npm run compat:baseline`
 *
 * Regenerating the baseline to make the test green is the one response that
 * is always wrong.
 */

const BASELINE = resolve(import.meta.dirname, "compatibility/baseline.json");

async function recorded(): Promise<Baseline> {
  return JSON.parse(await readFile(BASELINE, "utf8")) as Baseline;
}

describe("contract stability — agent/v1alpha2", () => {
  it("still compiles every manifest that used to compile", async () => {
    // renderBaseline throws if a fixture stops validating, so reaching here
    // already proves the manifests are still accepted.
    const now = await renderBaseline();
    const before = await recorded();
    expect(Object.keys(now).toSorted()).toEqual(Object.keys(before).toSorted());
  });

  it("produces the same CompiledAgent for each of them", async () => {
    const now = await renderBaseline();
    const before = await recorded();

    for (const [file, snapshot] of Object.entries(before)) {
      expect(now[file], `compatibility fixture '${file}' is missing`).toBeDefined();
      // Checksum first: a changed fixture would otherwise look like a
      // changed compiler.
      expect(
        now[file]?.manifestChecksum,
        `'${file}' was edited — golden fixtures are frozen, see tests/compatibility/manifests/README.md`,
      ).toBe(snapshot.manifestChecksum);
      expect(now[file], `Builder output changed for '${file}'`).toEqual(snapshot);
    }
  });

  it("has not started refusing a manifest any runtime used to accept", async () => {
    const now = await renderBaseline();
    const before = await recorded();

    for (const [file, snapshot] of Object.entries(before)) {
      for (const [id, was] of Object.entries(snapshot.runtimes)) {
        if (was.refusesRun) continue;
        expect(
          now[file]?.runtimes[id]?.refusesRun,
          `'${id}' now refuses '${file}', which it used to run — that is a breaking change`,
        ).toBe(false);
      }
    }
  });

  it("has not added a blocking gap to a runtime for an existing manifest", async () => {
    const now = await renderBaseline();
    const before = await recorded();

    for (const [file, snapshot] of Object.entries(before)) {
      for (const [id, was] of Object.entries(snapshot.runtimes)) {
        const added = (now[file]?.runtimes[id]?.unsupported ?? []).filter(
          (gap) => !was.unsupported.includes(gap),
        );
        // Adding a gap name for a capability the manifest never used is fine;
        // adding one that applies to this manifest is not.
        expect(added, `'${id}' declares new gaps for '${file}': ${added.join(", ")}`).toEqual([]);
      }
    }
  });
});
