import type {
  AgentHandle,
  AgentResult,
  AgentRuntime,
  CompiledAgent,
  ResolvedTool,
  RunContext,
  TraceEvent,
} from "../../builder/types.js";
import { attachMcpServers, type McpConnection } from "../mcp-client.js";

/**
 * DshRuntime — the DeepSeek Harness.
 *
 * This is the only file in the project that knows how DSH executes an agent.
 * It drives an OpenAI-compatible chat-completions endpoint (DeepSeek's own,
 * or llm-gateway in front of it) and runs the tool loop itself: model call ->
 * tool calls -> results -> repeat.
 *
 * Two invariants this file must never break:
 *
 *   1. It receives a CompiledAgent and nothing else. It cannot see a manifest,
 *      so it cannot grow manifest-specific behaviour.
 *   2. It offers the model exactly `compiled.tools`. A forbidden tool was
 *      already removed by the Builder, so there is nothing here to forget.
 */

const MAX_STEPS = 12;

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatResponse {
  choices?: { message?: ChatMessage; finish_reason?: string }[];
  error?: { message?: string };
}

interface DshHandle extends AgentHandle {
  compiled: CompiledAgent;
  connections: McpConnection[];
  /** wire-safe function name -> real tool */
  tools: Map<string, ResolvedTool>;
  /** compile-time gated names plus the ones MCP discovery added */
  approvalRequired: Set<string>;
}

/**
 * OpenAI-compatible function names allow [A-Za-z0-9_-] only, but our tool
 * names are dotted (`github.read`, `collaboration.create_task`). Map both
 * ways so the manifest keeps its readable names.
 */
function wireName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export class DshRuntime implements AgentRuntime {
  readonly id = "dsh";

  unsupported(_compiled: CompiledAgent): string[] {
    return [];
  }

  async createAgent(compiled: CompiledAgent): Promise<AgentHandle> {
    // attachMcpServers applies the manifest's policy to whatever the servers
    // turn out to expose, so `mcp.tools` here is already filtered.
    const mcp = await attachMcpServers(compiled);

    const tools = new Map<string, ResolvedTool>();
    for (const tool of [...compiled.tools, ...mcp.tools]) {
      tools.set(wireName(tool.name), tool);
    }

    const handle: DshHandle = {
      runtimeId: this.id,
      sessionId: `dsh-${compiled.name}-${Date.now()}`,
      compiled,
      connections: mcp.connections,
      tools,
      approvalRequired: new Set([...compiled.approvalRequired, ...mcp.approvalRequired]),
      dispose: async () => {
        await Promise.allSettled(mcp.connections.map((c) => c.close()));
      },
    };
    return handle;
  }

  async run(agent: AgentHandle, input: string, ctx: RunContext): Promise<AgentResult> {
    const handle = agent as DshHandle;
    const { compiled } = handle;

    const apiKey = process.env[compiled.model.apiKeyEnv];
    if (!apiKey) {
      throw new Error(
        `dsh: ${compiled.model.apiKeyEnv} is not set — needed to reach ${compiled.model.baseUrl}`,
      );
    }

    const trace: TraceEvent[] = [];
    const record = (kind: TraceEvent["kind"], detail: Record<string, unknown>) => {
      const event: TraceEvent = { at: new Date().toISOString(), kind, detail };
      trace.push(event);
      if (compiled.audit) ctx.onTrace(event);
    };

    const wireTools = [...handle.tools.entries()].map(([name, tool]) => ({
      type: "function" as const,
      function: { name, description: tool.description, parameters: tool.parameters },
    }));

    const messages: ChatMessage[] = [
      { role: "system", content: compiled.systemPrompt },
      { role: "user", content: input },
    ];

    let toolCalls = 0;

    for (let step = 0; step < MAX_STEPS; step += 1) {
      record("model_call", { step, model: compiled.model.id, messages: messages.length });

      const res = await fetch(`${compiled.model.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: compiled.model.id,
          messages,
          ...(wireTools.length ? { tools: wireTools, tool_choice: "auto" } : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      });

      const text = await res.text();
      if (!res.ok) {
        record("error", { status: res.status, body: text.slice(0, 400) });
        throw new Error(`dsh: HTTP ${res.status} from ${compiled.model.baseUrl} — ${text.slice(0, 400)}`);
      }

      const body = JSON.parse(text) as ChatResponse;
      if (body.error) throw new Error(`dsh: ${body.error.message ?? "unknown model error"}`);

      const message = body.choices?.[0]?.message;
      if (!message) throw new Error("dsh: model returned no choices");
      messages.push(message);

      const calls = message.tool_calls ?? [];
      if (!calls.length) {
        record("finish", { step, toolCalls });
        return {
          output: (message.content ?? "").trim(),
          sessionId: handle.sessionId,
          trace,
          toolCalls,
        };
      }

      for (const call of calls) {
        const tool = handle.tools.get(call.function.name);
        if (!tool) {
          // Reachable only if the model invents a name. Tell it plainly.
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `error: no such tool '${call.function.name}'`,
          });
          continue;
        }

        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
        } catch {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `error: arguments were not valid JSON`,
          });
          continue;
        }

        record("tool_call", { tool: tool.name, effect: tool.effect, args });

        if (handle.approvalRequired.has(tool.name)) {
          const decision = await ctx.requestApproval({
            tool: tool.name,
            effect: tool.effect,
            args,
            reason: compiled.autonomy.allowedEffects.includes(tool.effect)
              ? "policy.humanApproval"
              : "autonomy.level",
          });
          record("approval", { tool: tool.name, decision });
          if (decision === "deny") {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: `denied: a human declined '${tool.name}'. Do not retry it; continue without it or explain what you need.`,
            });
            continue;
          }
        }

        try {
          const result = await tool.execute(args);
          toolCalls += 1;
          record("tool_result", { tool: tool.name, chars: result.text.length });
          messages.push({ role: "tool", tool_call_id: call.id, content: result.text });
        } catch (err) {
          const msg = (err as Error).message;
          record("error", { tool: tool.name, message: msg });
          messages.push({ role: "tool", tool_call_id: call.id, content: `error: ${msg}` });
        }
      }
    }

    record("error", { message: `stopped after ${MAX_STEPS} steps` });
    throw new Error(`dsh: agent did not finish within ${MAX_STEPS} steps`);
  }

  async resume(sessionId: string): Promise<AgentHandle> {
    throw new Error(`DshRuntime.resume('${sessionId}') is not implemented (planned P5)`);
  }
}
