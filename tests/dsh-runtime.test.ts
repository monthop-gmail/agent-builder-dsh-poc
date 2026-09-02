import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";
import { DshRuntime } from "../runtimes/dsh/adapter.js";
import type { ApprovalRequest, TraceEvent } from "../builder/types.js";

/**
 * Exercises the real DshRuntime — its actual agent loop, tool calling,
 * approval gate and trace — against a stub OpenAI-compatible server on
 * localhost.
 *
 * The point is that nothing here is mocked out of the runtime. DSH does the
 * same fetch, the same tool_calls parsing and the same message threading it
 * would do against opencode zen or DeepSeek; only the server on the other end
 * is ours, so CI needs no credentials and no network.
 */

interface WireRequest {
  model: string;
  messages: { role: string; content: string | null; tool_call_id?: string }[];
  tools?: { function: { name: string } }[];
}

/** Replies the stub hands back, in order. */
type Reply = { tool: string; args: unknown } | { text: string };

let server: Server;
let baseUrl: string;
let received: WireRequest[] = [];
let authHeaders: (string | undefined)[] = [];
let queue: Reply[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(JSON.parse(body) as WireRequest);
      authHeaders.push(req.headers.authorization);

      const reply = queue.shift() ?? { text: "done" };
      const message =
        "tool" in reply
          ? {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: `call_${received.length}`,
                  type: "function",
                  function: { name: reply.tool, arguments: JSON.stringify(reply.args) },
                },
              ],
            }
          : { role: "assistant", content: reply.text };

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message, finish_reason: "stop" }] }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/v1`;

  // Routing through the gateway is also what B1 asks for, so the happy path
  // and the compliant path are the same path.
  process.env.LLM_GATEWAY_BASE_URL = baseUrl;
  process.env.LLM_GATEWAY_API_KEY = "test-key";
});

afterAll(async () => {
  delete process.env.LLM_GATEWAY_BASE_URL;
  delete process.env.LLM_GATEWAY_API_KEY;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function reset(replies: Reply[]) {
  received = [];
  authHeaders = [];
  queue = [...replies];
}

function agentFor(spec: Record<string, unknown>) {
  const candidate = {
    apiVersion: "agent/v1alpha2",
    kind: "Agent",
    metadata: { name: "dsh-fixture", version: "0.1.0" },
    spec: {
      purpose: { primary: "test" },
      model: { preferred: ["deepseek"] },
      autonomy: { level: 3 },
      audit: { required: true },
      ...spec,
    },
  };
  const result = validateManifest(candidate);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return compileManifest(candidate as AgentManifest, "y".repeat(64)).agent;
}

async function run(
  agent: ReturnType<typeof agentFor>,
  input: string,
  decision: "allow" | "deny" = "allow",
) {
  const runtime = new DshRuntime();
  const handle = await runtime.createAgent(agent);
  const approvals: ApprovalRequest[] = [];
  const trace: TraceEvent[] = [];
  try {
    const result = await runtime.run(handle, input, {
      async requestApproval(req) {
        approvals.push(req);
        return decision;
      },
      onTrace(e) {
        trace.push(e);
      },
    });
    return { result, approvals, trace };
  } finally {
    await handle.dispose();
  }
}

describe("DshRuntime against an OpenAI-compatible endpoint", () => {
  it("routes to the gateway base URL with a bearer token", async () => {
    reset([{ text: "hello" }]);
    const agent = agentFor({ tools: { allowed: ["calculator"] } });
    expect(agent.model.route).toBe("gateway");
    expect(agent.model.baseUrl).toBe(baseUrl);

    const { result } = await run(agent, "hi");
    expect(result.output).toBe("hello");
    expect(authHeaders[0]).toBe("Bearer test-key");
  });

  it("completes a full tool-call round trip", async () => {
    reset([{ tool: "calculator", args: { expression: "6*7" } }, { text: "The answer is 42." }]);
    const agent = agentFor({ tools: { allowed: ["calculator"] } });

    const { result, trace } = await run(agent, "What is 6 * 7?");

    expect(result.output).toBe("The answer is 42.");
    expect(result.toolCalls).toBe(1);
    expect(received).toHaveLength(2);

    // the tool's real output was threaded back to the model
    const toolMessage = received[1]?.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain("42");

    expect(trace.map((e) => e.kind)).toEqual([
      "model_call",
      "tool_call",
      "tool_result",
      "model_call",
      "finish",
    ]);
  });

  it("offers the model only the tools policy granted", async () => {
    reset([{ text: "ok" }]);
    const agent = agentFor({
      tools: { allowed: ["calculator", "github.merge"] },
      policy: { forbidden: ["github.merge"] },
    });

    await run(agent, "hi");

    const offered = (received[0]?.tools ?? []).map((t) => t.function.name);
    expect(offered).toEqual(["calculator"]);
    expect(offered).not.toContain("github_merge");
  });

  it("sanitises dotted tool names for the wire but keeps them in the manifest", async () => {
    reset([{ text: "ok" }]);
    const agent = agentFor({ tools: { allowed: ["github.read"] } });

    await run(agent, "hi");

    expect(agent.tools.map((t) => t.name)).toEqual(["github.read"]);
    expect((received[0]?.tools ?? []).map((t) => t.function.name)).toEqual(["github_read"]);
  });

  it("asks before a gated tool and tells the model plainly when denied", async () => {
    reset([{ tool: "github_comment", args: { repo: "a/b", number: 1, body: "hi" } }, { text: "understood" }]);
    const agent = agentFor({
      tools: { allowed: ["github.comment"] },
      humanApproval: { required: ["github.comment"] },
    });

    const { result, approvals } = await run(agent, "comment on it", "deny");

    expect(approvals.map((a) => a.tool)).toEqual(["github.comment"]);
    expect(approvals[0]?.reason).toBe("policy.humanApproval");
    // denied means the tool never ran
    expect(result.toolCalls).toBe(0);
    const toolMessage = received[1]?.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain("denied");
    expect(result.output).toBe("understood");
  });

  it("reports a hallucinated tool name back to the model instead of crashing", async () => {
    reset([{ tool: "no_such_tool", args: {} }, { text: "sorry" }]);
    const agent = agentFor({ tools: { allowed: ["calculator"] } });

    const { result } = await run(agent, "hi");

    const toolMessage = received[1]?.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain("no such tool");
    expect(result.output).toBe("sorry");
  });

  it("hands a failing tool's error to the model rather than aborting the run", async () => {
    reset([{ tool: "calculator", args: { expression: "drop table" } }, { text: "that failed" }]);
    const agent = agentFor({ tools: { allowed: ["calculator"] } });

    const { result, trace } = await run(agent, "hi");

    const toolMessage = received[1]?.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain("error:");
    expect(trace.some((e) => e.kind === "error")).toBe(true);
    expect(result.output).toBe("that failed");
  });

  it("sends the compiled system prompt as the first message", async () => {
    reset([{ text: "ok" }]);
    const agent = agentFor({
      tools: { allowed: ["calculator", "github.merge"] },
      policy: { forbidden: ["github.merge"] },
      skills: ["coder"],
    });

    await run(agent, "hi");

    const system = received[0]?.messages[0];
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("## Skill: coder");
    expect(system?.content).toContain("github.merge");
  });
});
