import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";
import { loadPlatformProfile } from "../builder/platform.js";

/**
 * `buildIdentity` — what a built agent IS.
 *
 * We reported the underlying bug ourselves (`agent-platform#52`): the model
 * catalog can move while the manifest sits still, so a checksum taken over
 * the manifest alone says two builds are the same when they are not. ADR-0025
 * answered it, and the answer is what these tests pin.
 */

const fixture = (name: string) => resolve(import.meta.dirname, "../manifests", name);
const profile = (name: string) =>
  loadPlatformProfile(resolve(import.meta.dirname, "fixtures/platform", name));

async function build(file: string, opts?: { platform?: Awaited<ReturnType<typeof profile>> }) {
  const loaded = await loadManifest(fixture(file));
  const result = validateManifest(loaded.value);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return compileManifest(loaded.value as AgentManifest, loaded.checksum, {
    platform: opts?.platform,
  }).agent;
}

describe("buildIdentity", () => {
  it("is stable for the same inputs", async () => {
    const a = await build("researcher.yaml");
    const b = await build("researcher.yaml");
    expect(a.buildIdentity).toBe(b.buildIdentity);
    expect(a.buildIdentity).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs between different manifests", async () => {
    const a = await build("researcher.yaml");
    const b = await build("code-reviewer.yaml");
    expect(a.buildIdentity).not.toBe(b.buildIdentity);
  });

  it("changes when the fallback ORDER changes, though the chain is the same set", async () => {
    const loaded = await loadManifest(fixture("researcher.yaml"));
    const value = loaded.value as AgentManifest;
    const preferred = value.spec.model.preferred;
    expect(preferred.length, "this test needs a manifest with a fallback chain").toBeGreaterThan(1);

    const forward = compileManifest(value, loaded.checksum).agent;
    const reversed = compileManifest(
      { ...value, spec: { ...value.spec, model: { preferred: [...preferred].reverse() } } },
      loaded.checksum,
    ).agent;

    // Same models, same manifest bytes, different behaviour the moment the
    // first endpoint answers 429 — ADR-0025: "สลับลำดับ = พฤติกรรมต่างกัน
    // ภายใต้ความล้มเหลวเดียวกัน". An identity that cannot tell these apart
    // lies under exactly the conditions it exists for.
    expect(forward.manifestChecksum).toBe(reversed.manifestChecksum);
    expect(forward.buildIdentity).not.toBe(reversed.buildIdentity);
  });

  it("changes when a platform ceiling is applied", async () => {
    const bare = await build("code-reviewer.yaml");
    const ceilinged = await build("code-reviewer.yaml", {
      platform: await profile("narrow.profile.yaml"),
    });

    expect(bare.manifestChecksum).toBe(ceilinged.manifestChecksum);
    expect(bare.buildIdentity).not.toBe(ceilinged.buildIdentity);
  });

  it("changes when the profile's own bytes change, not just its name", async () => {
    const original = await profile("narrow.profile.yaml");
    const edited = { ...original, checksum: `${original.checksum.slice(0, 63)}0` };

    const a = await build("code-reviewer.yaml", { platform: original });
    const b = await build("code-reviewer.yaml", { platform: edited });

    // Same `profile_id`, different file. A ceiling identified by name alone
    // would call these the same agent.
    expect(a.buildIdentity).not.toBe(b.buildIdentity);
  });

  it("does not cover the model actually used at run time", async () => {
    // ADR-0025 put that in `execution/v1.provider_switches`, because an
    // artifact whose identity depended on a run would have no identity until
    // it was run. Asserted here so nobody 'fixes' identity by folding the
    // chosen endpoint in.
    const agent = await build("researcher.yaml");
    const chain = [agent.model, ...agent.modelFallbacks];
    expect(chain.length).toBeGreaterThan(1);
    expect(Object.keys(agent)).not.toContain("modelUsed");
  });
});
