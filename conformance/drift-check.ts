/**
 * Are the vendored schemas still what upstream says they are?
 *
 * Runs SEPARATELY from `payload-check.ts` and needs the network. Keeping them
 * apart is the whole point: a conformance job that goes red because GitHub was
 * slow teaches people to stop believing red, which `agent-platform` itself just
 * wrote down when it split "404" from "could not check" in its own tooling
 * (#49). So this script distinguishes the same three cases:
 *
 *   file gone (404)      → DRIFT. The pin points at something that no longer
 *                          exists at that path. Real finding, exit non-zero.
 *   content differs      → DRIFT. Re-vendor deliberately and read the diff.
 *   could not reach it   → UNKNOWN. Says so and exits zero, because "we did
 *                          not check" is not "we checked and it was fine",
 *                          and it is not a failure of this repo either.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";

const here = import.meta.dirname;
const out = (s: string) => process.stdout.write(`${s}\n`);
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);

interface Pinned {
  repo: string;
  commit: string;
  schemas: string[];
}

async function main(): Promise<void> {
  const pinned = parseYaml(await readFile(resolve(here, "pinned.yaml"), "utf8")) as Pinned;
  const ref = process.argv[2] ?? "main";

  out(`\npinned at ${pinned.commit.slice(0, 12)} · comparing against ${pinned.repo}@${ref}\n`);

  let drifted = 0;
  let unchecked = 0;

  for (const rel of pinned.schemas) {
    const url = `https://raw.githubusercontent.com/${pinned.repo}/${ref}/${rel}`;
    const local = await readFile(resolve(here, "schemas", rel), "utf8");

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      unchecked += 1;
      out(`  ? ${rel} — not checked (${(error as Error).message})`);
      continue;
    }

    if (res.status === 404) {
      drifted += 1;
      out(`  ✗ ${rel} — 404 at ${ref}: the file moved or was deleted`);
      continue;
    }
    if (!res.ok) {
      unchecked += 1;
      out(`  ? ${rel} — not checked (HTTP ${res.status})`);
      continue;
    }

    const remote = await res.text();
    if (remote === local) {
      out(`  ✓ ${rel}`);
    } else {
      drifted += 1;
      out(`  ✗ ${rel} — differs (local ${sha(local)} vs ${ref} ${sha(remote)})`);
    }
  }

  if (unchecked) {
    out(
      `\n⚠ ${unchecked} file(s) could not be checked. That is NOT a pass — the pin\n` +
        `  may be stale and this run cannot tell you either way.`,
    );
  }

  if (drifted) {
    out(
      `\nDRIFT — ${drifted} file(s) changed upstream.\n` +
        `Re-vendor deliberately: copy the files, update pinned.yaml's commit, and read\n` +
        `the diff before trusting 'conformance: passing' again.\n`,
    );
    process.exit(1);
  }

  out(`\nOK — vendored copies match ${ref}\n`);
}

await main();
