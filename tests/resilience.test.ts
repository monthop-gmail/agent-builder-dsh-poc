import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";
import { DshRuntime } from "../runtimes/dsh/adapter.js";
import { openAuditLog } from "../builder/audit.js";
import { RunAborted, executedTools } from "../builder/errors.js";
import { startOpenAiStub, type OpenAiStub } from "./support/openai-stub.js";
import type { ApprovalRequest, TraceEvent } from "../builder/types.js";

/**
 * What happens when the endpoint misbehaves.
 *
 * Every case here was observed against a real free-tier gateway: 429 on one
 * model while another answered, 502 mid-conversation after a tool had already
 * written to a shared workspace. The point of these tests is that the run
 * either recovers or reports honestly — never quietly loses what it did.
 */

let stub: OpenAiStub;
/** No backoff: the wait is the thing under test least worth reproducing. */
const runtime = () => new DshRuntime({ attempts: 3, baseDelayMs: 0 });

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

const ctx = (decision: "allow" | "deny", trace: TraceEvent[] = []) => ({
  async requestApproval(_req: ApprovalRequest) {
    return decision;
  },
  onTrace(event: TraceEvent) {
    trace.push(event);
  },
});

describe("retry and fallback", () => {
  it("waits out a 429 and finishes", async () => {
    const agent = await compiled("gated-observer.yaml", "fixtures");
    const trace: TraceEvent[] = [];
    const handle = await runtime().createAgent(agent);
    try {
      stub.failQueue = [429, 429];
      stub.text = "recovered";
      const result = await runtime().run(handle, "hi", ctx("deny", trace));
      expect(result.output).toBe("recovered");
      expect(stub.requests).toHaveLength(3);
      expect(trace.filter((e) => e.kind === "retry")).toHaveLength(2);
    } finally {
      await handle.dispose();
    }
  });

  it("does not retry a status that will not change", async () => {
    const agent = await compiled("gated-observer.yaml", "fixtures");
    const handle = await runtime().createAgent(agent);
    try {
      stub.failQueue = [400];
      await expect(runtime().run(handle, "hi", ctx("deny"))).rejects.toThrow(/HTTP 400/);
      // One attempt, not three: 400 means "not like this", not "not now".
      expect(stub.requests).toHaveLength(1);
    } finally {
      await handle.dispose();
    }
  });

  it("moves to the next model the manifest named", async () => {
    const agent = await compiled("researcher.yaml");
    expect(agent.modelFallbacks.length).toBeGreaterThan(0);
    const fallback = agent.modelFallbacks[0]!;
    const trace: TraceEvent[] = [];
    const handle = await runtime().createAgent(agent);
    try {
      stub.failModels = { [agent.model.id]: 503 };
      stub.text = "answered by the fallback";
      const result = await runtime().run(handle, "hi", ctx("deny", trace));
      expect(result.output).toBe("answered by the fallback");
      expect(stub.requests.at(-1)?.model).toBe(fallback.id);
      // researcher.yaml sets audit off, so the trail lives on the result
      // rather than reaching ctx.onTrace — which is itself the contract.
      expect(trace).toEqual([]);
      expect(
        result.trace.some((e) => e.kind === "retry" && e.detail.to === fallback.requested),
      ).toBe(true);
    } finally {
      await handle.dispose();
    }
  });

  it("reports the tool calls that already landed when the run then fails", async () => {
    const agent = await compiled("gated-observer.yaml", "fixtures");
    const handle = await runtime().createAgent(agent);
    try {
      // The tool runs, then the next model turn dies — the exact shape that
      // used to be reported as if nothing had happened.
      stub.callQueue = [{ tool: "current_time" }];
      stub.failQueue = [null, 400];
      const failure = await runtime()
        .run(handle, "what time is it", ctx("allow"))
        .then(() => undefined, (error: unknown) => error);

      expect(failure).toBeInstanceOf(RunAborted);
      const aborted = failure as RunAborted;
      expect(aborted.result.toolCalls).toBe(1);
      expect(executedTools(aborted.result)).toEqual(["current_time"]);
    } finally {
      await handle.dispose();
    }
  });

  it("refuses to start when no named model has a key", async () => {
    const agent = await compiled("gated-observer.yaml", "fixtures");
    const saved = process.env.LLM_GATEWAY_API_KEY;
    delete process.env.LLM_GATEWAY_API_KEY;
    const handle = await runtime().createAgent(agent);
    try {
      await expect(runtime().run(handle, "hi", ctx("deny"))).rejects.toThrow(/no usable model/);
    } finally {
      process.env.LLM_GATEWAY_API_KEY = saved;
      await handle.dispose();
    }
  });
});

describe("audit log", () => {
  it("writes a run header and every event under one runId", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-builder-audit-"));
    const path = join(dir, "audit.jsonl");
    try {
      const agent = await compiled("code-reviewer.yaml");
      const sink = await openAuditLog(path, { agent, target: "dsh", input: "review it" });
      sink.record({ at: "2026-09-02T00:00:00.000Z", kind: "tool_call", detail: { tool: "github.read" } });
      sink.record({ at: "2026-09-02T00:00:01.000Z", kind: "finish", detail: { toolCalls: 1 } });
      await sink.close();

      const lines = (await readFile(path, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
      expect(lines).toHaveLength(3);

      const [header, ...events] = lines as [Record<string, unknown>, ...Record<string, unknown>[]];
      expect(header.type).toBe("run");
      expect(header.agent).toBe(`${agent.name}@${agent.version}`);
      // The checksum is what ties a log line back to the exact manifest bytes.
      expect(header.manifestChecksum).toBe(agent.manifestChecksum);
      expect(events.map((e) => e.kind)).toEqual(["tool_call", "finish"]);
      expect(events.every((e) => e.runId === sink.runId)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
