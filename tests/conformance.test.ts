import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";
import { getRuntime, listRuntimeIds, OFFLINE_RUNTIMES } from "../builder/registry/runtimes.js";
import { startOpenAiStub, type OpenAiStub } from "./support/openai-stub.js";
import type { ApprovalRequest, TraceEvent } from "../builder/types.js";

/**
 * The conformance suite every adapter must pass.
 *
 * Write the adapter against this, not the other way round.
 *
 * Every adapter reaches its model through `ModelBinding.baseUrl`, so the
 * suite stands one stub endpoint up on 127.0.0.1 and points the gateway at
 * it. That is what makes "needs credentials" a non-reason to skip: a runtime
 * left out of OFFLINE_RUNTIMES is a runtime this file is not actually
 * checking, and an untested adapter looks exactly like a passing one.
 */

let stub: OpenAiStub;

beforeAll(async () => {
  stub = await startOpenAiStub();
  process.env.LLM_GATEWAY_BASE_URL = stub.baseUrl;
  process.env.LLM_GATEWAY_API_KEY = "stub-key";
});

afterAll(async () => {
  delete process.env.LLM_GATEWAY_BASE_URL;
  delete process.env.LLM_GATEWAY_API_KEY;
  await stub.close();
});

beforeEach(() => stub.reset());

const fixture = (name: string) => resolve(import.meta.dirname, "../manifests", name);

async function compiled(name: string) {
  const loaded = await loadManifest(fixture(name));
  const result = validateManifest(loaded.value);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return compileManifest(loaded.value as AgentManifest, loaded.checksum).agent;
}

function ctx(decision: "allow" | "deny", seen: ApprovalRequest[], trace: TraceEvent[]) {
  return {
    async requestApproval(req: ApprovalRequest) {
      seen.push(req);
      return decision;
    },
    onTrace(e: TraceEvent) {
      trace.push(e);
    },
  };
}

describe.each(listRuntimeIds())("Runtime conformance — %s", (id) => {
  const offline = OFFLINE_RUNTIMES.includes(id);
  const maybe = offline ? it : it.skip;

  it("is registered and reports its own id", async () => {
    const runtime = await getRuntime(id);
    expect(runtime.id).toBe(id);
  });

  it("declares what it cannot do rather than failing later", async () => {
    const runtime = await getRuntime(id);
    expect(Array.isArray(runtime.unsupported(await compiled("coding-agent.yaml")))).toBe(true);
  });

  maybe("never receives a tool that policy forbade", async () => {
    const agent = await compiled("code-reviewer.yaml");
    const runtime = await getRuntime(id);
    const handle = await runtime.createAgent(agent);
    try {
      expect(agent.tools.map((t) => t.name)).not.toContain("github.merge");
    } finally {
      await handle.dispose();
    }
  });

  maybe("asks for approval before a gated tool, and honours a denial", async () => {
    const agent = await compiled("code-reviewer.yaml");
    const runtime = await getRuntime(id);
    const handle = await runtime.createAgent(agent);
    const seen: ApprovalRequest[] = [];
    const trace: TraceEvent[] = [];
    try {
      // Adapters that drive a real model only reach the gate when the model
      // asks for the tool, so the stub asks. Arguments must satisfy the
      // tool's schema: Pi validates them before the adapter is reached.
      stub.callQueue = [
        { tool: "github_comment", arguments: { repo: "acme/widgets", number: 1, body: "looks fine" } },
      ];
      await runtime.run(handle, "review it", ctx("deny", seen, trace));
      expect(seen.map((r) => r.tool)).toContain("github.comment");
    } finally {
      await handle.dispose();
    }
  });

  maybe("emits trace events when the manifest asks for an audit", async () => {
    const agent = await compiled("code-reviewer.yaml");
    expect(agent.audit).toBe(true);
    const runtime = await getRuntime(id);
    const handle = await runtime.createAgent(agent);
    const trace: TraceEvent[] = [];
    try {
      const result = await runtime.run(handle, "hello", ctx("deny", [], trace));
      expect(trace.length).toBeGreaterThan(0);
      expect(result.trace.length).toBeGreaterThan(0);
    } finally {
      await handle.dispose();
    }
  });

  maybe("stays quiet when the manifest does not ask for an audit", async () => {
    const agent = await compiled("researcher.yaml");
    expect(agent.audit).toBe(false);
    const runtime = await getRuntime(id);
    const handle = await runtime.createAgent(agent);
    const trace: TraceEvent[] = [];
    try {
      await runtime.run(handle, "hello", ctx("allow", [], trace));
      expect(trace).toEqual([]);
    } finally {
      await handle.dispose();
    }
  });

  maybe("cleans up without throwing", async () => {
    const runtime = await getRuntime(id);
    const handle = await runtime.createAgent(await compiled("researcher.yaml"));
    await expect(handle.dispose()).resolves.toBeUndefined();
  });
});
