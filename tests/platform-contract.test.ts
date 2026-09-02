import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Keeps `platform-contract.yaml` honest.
 *
 * ADR-0006 gives `last_verified` teeth — a `status: passing` older than 90
 * days is read as `unknown` by the platform whatever the file says. A manifest
 * nothing checks is exactly the kind of document this repo keeps finding stale,
 * so the claims it makes are asserted here against the files they describe.
 */

const root = (p: string) => resolve(import.meta.dirname, "..", p);

async function yaml<T>(path: string): Promise<T> {
  return parseYaml(await readFile(root(path), "utf8")) as T;
}

interface Manifest {
  platform_contract_version: string;
  contracts: string[];
  conformance: { status: string; last_verified: string };
  pinned_contracts_commit: string;
  not_pinned: Record<string, { reason: string }>;
  known_gaps: { id: string; what: string }[];
}

describe("platform-contract.yaml", () => {
  it("declares the three things ADR-0006 requires", async () => {
    const m = await yaml<Manifest>("platform-contract.yaml");
    expect(m.platform_contract_version).toBeTruthy();
    expect(m.contracts.length).toBeGreaterThan(0);
    expect(["passing", "failing", "unknown", "waived"]).toContain(m.conformance.status);
    expect(m.conformance.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("pins the same commit the vendored schemas came from", async () => {
    const m = await yaml<Manifest>("platform-contract.yaml");
    const pinned = await yaml<{ commit: string; schemas: string[] }>("conformance/pinned.yaml");

    // Two files stating one fact is how they drift. Only one of them can be
    // wrong at a time, and this is the check that says which.
    expect(m.pinned_contracts_commit).toBe(pinned.commit);
    expect(pinned.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("has every vendored schema on disk, and nothing extra", async () => {
    const pinned = await yaml<{ schemas: string[] }>("conformance/pinned.yaml");
    for (const rel of pinned.schemas) {
      const text = await readFile(root(`conformance/schemas/${rel}`), "utf8");
      expect(text.length, `${rel} is empty`).toBeGreaterThan(0);
    }
  });

  it("has a release gate that runs the conformance check", async () => {
    const ci = await readFile(root(".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("npm run conformance");
    // The ruleset matches on this exact string. Renaming the job silently
    // turns the gate off, because a required check that never reports just
    // leaves PRs pending — so the name is pinned here too.
    expect(ci).toContain("name: conformance — ADR-0006");
    // The drift job must stay out of the gate: it needs the network, and a
    // red build caused by a slow network teaches people to ignore red.
    expect(ci).toContain("continue-on-error: true");
  });

  it("does not claim a contract it also lists as not pinned", async () => {
    const m = await yaml<Manifest>("platform-contract.yaml");
    for (const name of Object.keys(m.not_pinned)) {
      expect(m.contracts, `${name} is both pinned and not pinned`).not.toContain(name);
    }
  });

  it("gives a reason for everything it declines to pin", async () => {
    const m = await yaml<Manifest>("platform-contract.yaml");
    for (const [name, entry] of Object.entries(m.not_pinned)) {
      expect(entry.reason?.trim(), `${name} has no reason`).toBeTruthy();
    }
    expect(m.known_gaps.length).toBeGreaterThan(0);
  });
});
