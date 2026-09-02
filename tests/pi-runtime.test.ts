import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";
import { PiRuntime } from "../runtimes/pi/adapter.js";
import { startOpenAiStub, type OpenAiStub } from "./support/openai-stub.js";
import type { ApprovalRequest, TraceEvent } from "../builder/types.js";

/**
 * Exercises the real PiRuntime — the actual Pi harness, its own agent loop —
 * against a stub OpenAI-compatible server on localhost.
 *
 * Nothing about Pi is mocked. What is under test is the contract the adapter
 * is responsible for while Pi drives: that Pi's built-in tools never appear,
 * that a forbidden tool never arrives, that approval gates a call before the
 * side effect runs, and that the model the Builder resolved is the model that
 * goes on the wire.
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

async function compiled(name: string, dir = "../manifests") {
  const loaded = await loadManifest(resolve(import.meta.dirname, dir, name));
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
    onTrace(event: TraceEvent) {
      trace.push(event);
    },
  };
}

describe("PiRuntime against a stub endpoint", () => {
  it("sends the model the Builder resolved, to the Builder's base URL", async () => {
    const agent = await compiled("researcher.yaml");
    const runtime = new PiRuntime();
    const handle = await runtime.createAgent(agent);
    try {
      stub.text = "hello from the stub";
      const result = await runtime.run(handle, "hi", ctx("allow", [], []));
      expect(result.output).toBe("hello from the stub");
      expect(stub.requests[0]?.model).toBe(agent.model.id);
      expect(agent.model.route).toBe("gateway");
    } finally {
      await handle.dispose();
    }
  });

  it("offers exactly the granted tools — no Pi built-ins leak in", async () => {
    const agent = await compiled("code-reviewer.yaml");
    const runtime = new PiRuntime();
    const handle = await runtime.createAgent(agent);
    try {
      await runtime.run(handle, "review", ctx("deny", [], []));
      const offered = stub.requests[0]?.toolNames ?? [];
      expect(offered.toSorted()).toEqual(["github_comment", "github_read"]);
      for (const builtin of ["bash", "read", "write", "edit"]) {
        expect(offered).not.toContain(builtin);
      }
    } finally {
      await handle.dispose();
    }
  });

  it("never offers a tool the manifest forbade", async () => {
    const agent = await compiled("code-reviewer.yaml");
    const runtime = new PiRuntime();
    const handle = await runtime.createAgent(agent);
    try {
      await runtime.run(handle, "merge it", ctx("deny", [], []));
      expect(stub.requests[0]?.toolNames).not.toContain("github_merge");
    } finally {
      await handle.dispose();
    }
  });

  it("asks before a gated tool and does not run it on a denial", async () => {
    const agent = await compiled("gated-observer.yaml", "fixtures");
    const runtime = new PiRuntime();
    const handle = await runtime.createAgent(agent);
    const seen: ApprovalRequest[] = [];
    const trace: TraceEvent[] = [];
    try {
      stub.callQueue = [{ tool: "current_time" }];
      const result = await runtime.run(handle, "what time is it", ctx("deny", seen, trace));
      expect(seen.map((r) => r.tool)).toEqual(["current_time"]);
      expect(seen[0]?.reason).toBe("autonomy.level");
      // The gate is the point: a denied call must not count as executed.
      expect(result.toolCalls).toBe(0);
      expect(trace.map((e) => e.kind)).toContain("approval");
    } finally {
      await handle.dispose();
    }
  });

  it("runs a gated tool once approved", async () => {
    const agent = await compiled("gated-observer.yaml", "fixtures");
    const runtime = new PiRuntime();
    const handle = await runtime.createAgent(agent);
    const seen: ApprovalRequest[] = [];
    const trace: TraceEvent[] = [];
    try {
      stub.callQueue = [{ tool: "current_time" }];
      const result = await runtime.run(handle, "what time is it", ctx("allow", seen, trace));
      expect(seen).toHaveLength(1);
      expect(result.toolCalls).toBe(1);
      expect(trace.map((e) => e.kind)).toContain("tool_result");
    } finally {
      await handle.dispose();
    }
  });

  it("refuses to start without the key the Builder named", async () => {
    const agent = await compiled("researcher.yaml");
    const saved = process.env.LLM_GATEWAY_API_KEY;
    delete process.env.LLM_GATEWAY_API_KEY;
    try {
      await expect(new PiRuntime().createAgent(agent)).rejects.toThrow(/LLM_GATEWAY_API_KEY/);
    } finally {
      process.env.LLM_GATEWAY_API_KEY = saved;
    }
  });

  it("declares what it cannot honour instead of pretending", async () => {
    const runtime = new PiRuntime();

    // audit on, one model named: only the trace-fidelity gap applies.
    const reviewer = await compiled("code-reviewer.yaml");
    expect(reviewer.modelFallbacks).toEqual([]);
    expect(runtime.unsupported(reviewer)).toEqual(["trace.model_step"]);

    // audit off, two models named: a Pi session is bound to one provider, so
    // the manifest's fallback is not reachable and the adapter says so.
    const researcher = await compiled("researcher.yaml");
    expect(researcher.modelFallbacks.length).toBeGreaterThan(0);
    expect(runtime.unsupported(researcher)).toEqual(["model.fallback"]);
  });
});
