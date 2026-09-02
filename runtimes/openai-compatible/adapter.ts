import type {
  AgentHandle,
  AgentResult,
  AgentRuntime,
  CompiledAgent,
  ModelBinding,
  ProviderSwitch,
  ResolvedTool,
  SwitchReason,
  RunContext,
  TraceEvent,
} from "../../builder/types.js";
import { RunAborted } from "../../builder/errors.js";
import {
  DEFAULT_RETRY,
  isRetryableStatus,
  retryDelayMs,
  sleep,
  type RetryPolicy,
} from "../../builder/retry.js";
import { attachMcpServers, type McpConnection } from "../mcp-client.js";
import { indexByWireName } from "../../builder/tool-names.js";

/**
 * OpenAiCompatibleRuntime — our own agent loop over any OpenAI-compatible
 * chat-completions endpoint: llm-gateway, opencode zen, DeepSeek's own API,
 * a local server. Model call -> tool calls -> results -> repeat.
 *
 * It used to be called `dsh`, which was wrong: it never imported anything
 * from DeepSeek Harness and never spoke to it. The real DSH integration
 * lives under that name now; this one is named for what it actually does,
 * which is also what makes it the widest-reach target in the repo.
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

interface OpenAiHandle extends AgentHandle {
  compiled: CompiledAgent;
  connections: McpConnection[];
  /** wire-safe function name -> real tool */
  tools: Map<string, ResolvedTool>;
  /** compile-time gated names plus the ones MCP discovery added */
  approvalRequired: Set<string>;
}

export class OpenAiCompatibleRuntime implements AgentRuntime {
  readonly id = "openai-compatible";

  /** Injectable so tests can drop the backoff instead of waiting it out. */
  constructor(private readonly retry: RetryPolicy = DEFAULT_RETRY) {}

  unsupported(_compiled: CompiledAgent): string[] {
    return [];
  }

  async createAgent(compiled: CompiledAgent): Promise<AgentHandle> {
    // attachMcpServers applies the manifest's policy to whatever the servers
    // turn out to expose, so `mcp.tools` here is already filtered.
    const mcp = await attachMcpServers(compiled);

    const tools = indexByWireName([...compiled.tools, ...mcp.tools]);

    const handle: OpenAiHandle = {
      runtimeId: this.id,
      sessionId: `oai-${compiled.name}-${Date.now()}`,
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
    const handle = agent as OpenAiHandle;
    const { compiled } = handle;

    const trace: TraceEvent[] = [];
    const switches: ProviderSwitch[] = [];
    let toolCalls = 0;
    const record = (kind: TraceEvent["kind"], detail: Record<string, unknown>) => {
      const event: TraceEvent = { at: new Date().toISOString(), kind, detail };
      trace.push(event);
      if (compiled.audit) ctx.onTrace(event);
    };

    // Which endpoint answered last. Once the primary is refusing, starting
    // from the one that worked stops every later step paying its retries.
    // Declared up here because `abort` below reads it, and the first abort can
    // fire before the model loop is ever entered.
    let preferred = 0;

    /**
     * `providerId` is whichever endpoint is in effect NOW, and the switches
     * are omitted entirely when there were none — `execution/v1` forbids `[]`
     * so that "never switched" cannot be confused with "not recorded".
     */
    const reportedProviders = () => ({
      providerId: endpoints[preferred]?.binding.requested,
      ...(switches.length ? { providerSwitches: switches } : {}),
    });

    /**
     * Fail with what already happened attached. A tool that ran before the
     * model died has left its side effect behind; reporting a bare error
     * would tell the caller nothing happened.
     */
    const abort = (message: string): never => {
      throw new RunAborted(`openai-compatible: ${message}`, {
        output: "",
        sessionId: handle.sessionId,
        trace,
        toolCalls,
        ...reportedProviders(),
      });
    };

    const endpoints = usableEndpoints(compiled, record);
    if (!endpoints.length) {
      abort(
        `no usable model: ${[compiled.model, ...compiled.modelFallbacks]
          .map((m) => `${m.requested} needs ${m.apiKeyEnv}`)
          .join("; ")}`,
      );
    }

    const wireTools = [...handle.tools.entries()].map(([name, tool]) => ({
      type: "function" as const,
      function: { name, description: tool.description, parameters: tool.parameters },
    }));

    const messages: ChatMessage[] = [
      { role: "system", content: compiled.systemPrompt },
      { role: "user", content: input },
    ];


    for (let step = 0; step < MAX_STEPS; step += 1) {
      const attempt = await callWithFallback(
        endpoints,
        preferred,
        (binding) => ({
          model: binding.id,
          messages,
          ...(wireTools.length ? { tools: wireTools, tool_choice: "auto" } : {}),
        }),
        this.retry,
        record,
        step,
        switches,
      );
      if (!attempt.body) {
        record("error", { step, message: attempt.lastError });
        abort(attempt.lastError);
      }
      preferred = attempt.index;

      const body = attempt.body as ChatResponse;
      if (body.error) abort(body.error.message ?? "unknown model error");

      const message = body.choices?.[0]?.message;
      if (!message) abort("model returned no choices");
      messages.push(message as ChatMessage);

      const calls = (message as ChatMessage).tool_calls ?? [];
      if (!calls.length) {
        record("finish", { step, toolCalls });
        return {
          output: ((message as ChatMessage).content ?? "").trim(),
          sessionId: handle.sessionId,
          trace,
          toolCalls,
          ...reportedProviders(),
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
    return abort(`agent did not finish within ${MAX_STEPS} steps`);
  }

  async resume(_compiled: CompiledAgent, sessionId: string): Promise<AgentHandle> {
    throw new Error(
      `OpenAiCompatibleRuntime.resume('${sessionId}'): this runtime keeps no session across processes. ` +
        `Use --target acp for a runtime that does.`,
    );
  }
}

interface Endpoint {
  binding: ModelBinding;
  apiKey: string;
}

/**
 * The models this process can actually reach, in manifest order.
 *
 * A fallback whose key is absent is dropped here rather than at the moment it
 * is needed, and the drop is traced: silently having no fallback left is how
 * a run appears to have had no alternative.
 */
function usableEndpoints(
  compiled: CompiledAgent,
  record: (kind: TraceEvent["kind"], detail: Record<string, unknown>) => void,
): Endpoint[] {
  const endpoints: Endpoint[] = [];
  for (const binding of [compiled.model, ...compiled.modelFallbacks]) {
    const apiKey = process.env[binding.apiKeyEnv];
    if (apiKey) endpoints.push({ binding, apiKey });
    else record("retry", { skipped: binding.requested, reason: `${binding.apiKeyEnv} is not set` });
  }
  return endpoints;
}

interface CallOutcome {
  body?: ChatResponse;
  /** Endpoint that answered, so the next step can start there. */
  index: number;
  lastError: string;
}

/**
 * Why we left an endpoint, in `error/v1` `Category` terms.
 *
 * ADR-0025 reuses that enum for `provider_switches.reason` instead of minting
 * a new one, so the mapping happens once, here, rather than as a string in
 * whatever the trace happened to say.
 */
function switchReason(status: number): SwitchReason {
  if (status === 429) return "rate_limited";
  // 408, and the 0 we use for a thrown fetch — both mean no answer came back.
  if (status === 408 || status === 0) return "timeout";
  return "provider_error";
}

/**
 * One model turn: retry the preferred endpoint with backoff, then fall
 * through the rest of the chain.
 *
 * 429 and 5xx mean "not now" and are worth waiting on; anything else means
 * this endpoint will keep saying no, so the chain moves on rather than
 * burning the remaining attempts.
 */
async function callWithFallback(
  endpoints: Endpoint[],
  preferred: number,
  payload: (binding: ModelBinding) => Record<string, unknown>,
  policy: RetryPolicy,
  record: (kind: TraceEvent["kind"], detail: Record<string, unknown>) => void,
  step: number,
  switches: ProviderSwitch[],
): Promise<CallOutcome> {
  const order = [
    ...endpoints.slice(preferred),
    ...endpoints.slice(0, preferred),
  ];
  let lastError = "no endpoint was tried";

  for (const endpoint of order) {
    const index = endpoints.indexOf(endpoint);
    record("model_call", { step, model: endpoint.binding.id });
    let lastStatus = 0;

    for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
      let status = 0;
      try {
        const res = await fetch(`${endpoint.binding.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${endpoint.apiKey}`,
          },
          body: JSON.stringify(payload(endpoint.binding)),
          signal: AbortSignal.timeout(120_000),
        });
        status = res.status;
        lastStatus = status;
        const text = await res.text();
        if (res.ok) return { body: JSON.parse(text) as ChatResponse, index, lastError };
        lastError = `HTTP ${status} from ${endpoint.binding.baseUrl} — ${text.slice(0, 400)}`;
      } catch (error) {
        lastError = `${endpoint.binding.baseUrl}: ${(error as Error).message}`;
      }

      const worthWaiting = status === 0 || isRetryableStatus(status);
      if (!worthWaiting || attempt === policy.attempts) break;
      record("retry", { model: endpoint.binding.id, attempt, status, reason: lastError });
      await sleep(retryDelayMs(policy, attempt));
    }

    const next = order[order.indexOf(endpoint) + 1];
    if (next) {
      record("retry", { from: endpoint.binding.requested, to: next.binding.requested, reason: lastError });
      // The trace already said this in prose. `providerSwitches` says it in
      // the shape `execution/v1` accepts, because a record that only a human
      // can read is not an audit trail anyone can check.
      switches.push({
        from: endpoint.binding.requested,
        to: next.binding.requested,
        at: new Date().toISOString(),
        reason: switchReason(lastStatus),
      });
    }
  }

  return { index: preferred, lastError };
}
