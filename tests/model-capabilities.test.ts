import { afterEach, describe, expect, it } from "vitest";
import {
  NoCapableModelError,
  resetCatalog,
  resolveModelChain,
  setCatalogForTest,
  type CatalogEntry,
} from "../builder/registry/models.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { loadCatalog } from "../builder/registry/models.js";
import { compileManifest } from "../builder/compiler.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";

/**
 * Capability-first model selection — the consumer half of ADR-0009.
 *
 * Choosing freely from the whole catalog by capability is the platform
 * router's job, and this Builder is not the router. What it can do, and now
 * does, is refuse to bind a model that has not said it can do what the
 * manifest declared it needs — because ADR-0009 is equally clear that an
 * undeclared capability counts as ABSENT, not as "probably fine".
 */

const entry = (id: string, capabilities?: string[]): CatalogEntry => ({
  id,
  directBaseUrl: `https://example.invalid/${id}`,
  apiKeyEnv: "TEST_KEY",
  ...(capabilities ? { capabilities } : {}),
});

afterEach(resetCatalog);

function manifest(spec: Record<string, unknown>): AgentManifest {
  const value = {
    apiVersion: "agent/v1alpha2",
    kind: "Agent",
    metadata: { name: "cap-routing", version: "0.1.0" },
    spec: {
      purpose: { primary: "route by capability" },
      autonomy: { level: 1 },
      tools: { allowed: ["current_time"] },
      ...spec,
    },
  };
  const result = validateManifest(value);
  expect(result.errors, result.errors.join("; ")).toEqual([]);
  return value as AgentManifest;
}

describe("required — eliminates", () => {
  it("drops a model that does not declare what the agent needs", () => {
    setCatalogForTest({
      plain: entry("plain-1"),
      tooled: entry("tooled-1", ["tool_calling"]),
    });

    const chain = resolveModelChain(["plain", "tooled"], { required: ["tool_calling"] });

    // `plain` is FIRST in the manifest's preference order and still loses.
    // A preference cannot outvote a requirement.
    expect(chain.map((b) => b.requested)).toEqual(["tooled"]);
  });

  it("refuses the build rather than binding an unchecked model", () => {
    setCatalogForTest({ plain: entry("plain-1"), other: entry("other-1", ["vision"]) });

    expect(() => resolveModelChain(["plain", "other"], { required: ["tool_calling"] })).toThrow(
      NoCapableModelError,
    );

    try {
      resolveModelChain(["plain", "other"], { required: ["tool_calling"] });
    } catch (error) {
      // The message has to say what each candidate DOES declare, or the
      // reader cannot tell "cannot do it" from "never said".
      expect((error as Error).message).toContain("declares [vision]");
      expect((error as Error).message).toContain("declares [nothing]");
    }
  });

  it("treats an undeclared capability as absent, not as unknown-so-allow", () => {
    setCatalogForTest({ silent: entry("silent-1") });

    // ADR-0009's rule, and the reason the offline seed declares nothing: a
    // model that has not spoken does not get the benefit of the doubt.
    expect(() => resolveModelChain(["silent"], { required: ["tool_calling"] })).toThrow(
      NoCapableModelError,
    );
  });
});

describe("preferred — ranks, does not eliminate", () => {
  it("promotes the model that matches more preferences", () => {
    setCatalogForTest({
      basic: entry("basic-1", ["tool_calling"]),
      rich: entry("rich-1", ["tool_calling", "long_context", "vision"]),
    });

    const chain = resolveModelChain(["basic", "rich"], {
      required: ["tool_calling"],
      preferred: ["long_context", "vision"],
    });

    expect(chain.map((b) => b.requested)).toEqual(["rich", "basic"]);
    // ...and `basic` is still THERE. A soft requirement ranks; it never cuts.
    expect(chain).toHaveLength(2);
  });

  it("keeps manifest order when nothing distinguishes the candidates", () => {
    setCatalogForTest({
      a: entry("a-1", ["tool_calling"]),
      b: entry("b-1", ["tool_calling"]),
    });

    const chain = resolveModelChain(["b", "a"], {
      required: ["tool_calling"],
      preferred: ["vision"],
    });
    expect(chain.map((b) => b.requested)).toEqual(["b", "a"]);
  });

  it("changes nothing at all when the manifest states no requirement", () => {
    setCatalogForTest({ one: entry("one-1"), two: entry("two-1", ["vision"]) });

    // Every manifest written before `spec.capabilities` existed must resolve
    // exactly as it did — this is the compatibility claim, tested directly.
    expect(resolveModelChain(["one", "two"]).map((b) => b.requested)).toEqual(["one", "two"]);
    expect(resolveModelChain(["one", "two"], {}).map((b) => b.requested)).toEqual(["one", "two"]);
  });
});

describe("through the compiler", () => {
  it("binds the capable model and keeps the rest as fallbacks", () => {
    setCatalogForTest({
      weak: entry("weak-1"),
      strong: entry("strong-1", ["tool_calling"]),
      alsoStrong: entry("also-1", ["tool_calling"]),
    });

    const built = compileManifest(
      manifest({
        model: { preferred: ["weak", "strong", "alsoStrong"] },
        capabilities: { required: ["tool_calling"] },
      }),
      "sum",
    );

    expect(built.agent.model.requested).toBe("strong");
    expect(built.agent.modelFallbacks.map((b) => b.requested)).toEqual(["alsoStrong"]);
  });

  it("puts the surviving chain into buildIdentity", () => {
    setCatalogForTest({
      weak: entry("weak-1"),
      strong: entry("strong-1", ["tool_calling"]),
    });

    const withRequirement = compileManifest(
      manifest({
        model: { preferred: ["weak", "strong"] },
        capabilities: { required: ["tool_calling"] },
      }),
      "sum",
    ).agent;
    const without = compileManifest(
      manifest({ model: { preferred: ["weak", "strong"] } }),
      "sum",
    ).agent;

    // Same manifest bytes as far as the checksum is concerned in this test,
    // but a different chain — and identity has to see that (ADR-0025).
    expect(withRequirement.buildIdentity).not.toBe(without.buildIdentity);
  });
});

describe("from free-llm-registry, not from this repo", () => {
  it("carries declarations off the wire and uses them to select", async () => {
    // The whole design rests on the registry being the one that declares, so
    // it is worth proving the declaration survives the trip rather than
    // assuming `catalog = body.models` keeps a field it was never told about.
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          models: {
            plain: { id: "plain-1", directBaseUrl: "https://a.invalid", apiKeyEnv: "K" },
            tooled: {
              id: "tooled-1",
              directBaseUrl: "https://b.invalid",
              apiKeyEnv: "K",
              capabilities: ["tool_calling", "long_context"],
            },
          },
        }),
      );
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;
    const previous = process.env.FREE_LLM_REGISTRY_URL;
    process.env.FREE_LLM_REGISTRY_URL = `http://127.0.0.1:${port}/catalog.json`;

    try {
      const loaded = await loadCatalog();
      expect(loaded.count).toBe(2);

      const chain = resolveModelChain(["plain", "tooled"], { required: ["tool_calling"] });
      expect(chain.map((b) => b.requested)).toEqual(["tooled"]);
      expect(chain[0]?.id).toBe("tooled-1");
    } finally {
      if (previous === undefined) delete process.env.FREE_LLM_REGISTRY_URL;
      else process.env.FREE_LLM_REGISTRY_URL = previous;
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
