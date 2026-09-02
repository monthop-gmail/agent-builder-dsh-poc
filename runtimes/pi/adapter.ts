import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentSession,
  ModelRuntime as PiModelRuntime,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
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
import { indexByWireName } from "../../builder/tool-names.js";

/**
 * PiRuntime — the Pi agent harness (`@earendil-works/pi-coding-agent`).
 *
 * Merged in from `agent-builder-pi-poc`. Unlike `dsh`, this adapter does not
 * own the agent loop: Pi does. What the adapter still owns completely is the
 * tool surface, and that is where the whole contract is kept:
 *
 *   1. Pi never sees the manifest — only a CompiledAgent, like every adapter.
 *   2. The model comes from the Builder's ModelBinding and is registered as a
 *      provider on a private ModelRuntime. Pi's own model catalogue is never
 *      consulted, so a model the Builder resolved cannot be silently replaced
 *      by Pi's default. (The predecessor did `getModel(...).catch(() =>
 *      undefined)`, which meant a manifest could name one model and run on
 *      another with nobody told.)
 *   3. `noTools: "all"` plus an explicit allowlist: Pi's own built-ins
 *      (read/bash/edit/write) never reach the model. Only `compiled.tools`
 *      and the MCP tools policy admitted do.
 *   4. Pi ships no permission system of its own — but the adapter writes each
 *      tool's `execute`, so approval is enforced there. On a denial the side
 *      effect never runs, which is the property that matters; the model is
 *      told rather than left guessing.
 */

/** Provider id registered on the private ModelRuntime. Never a real vendor. */
const PROVIDER_ID = "agent-builder";

/**
 * Pi wants a context window and an output cap per model. A ModelBinding
 * carries neither — the Builder resolves *where* a model lives, not its
 * shape — so these are deliberately conservative floors rather than guesses
 * that could truncate a reply mid-sentence.
 */
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

interface RunState {
  ctx: RunContext;
  trace: TraceEvent[];
  toolCalls: number;
}

interface PiHandle extends AgentHandle {
  compiled: CompiledAgent;
  session: AgentSession;
  beginRun(ctx: RunContext): RunState;
  endRun(): void;
}

export class PiRuntime implements AgentRuntime {
  readonly id = "pi";

  unsupported(compiled: CompiledAgent): string[] {
    // Pi owns the loop, so the adapter cannot see each model step — it can
    // report the turn it started and every tool call, but not per-step model
    // calls the way an adapter that drives the loop itself can. That is a
    // fidelity gap in the audit trail and only matters when audit is on.
    return compiled.audit ? ["trace.model_step"] : [];
  }

  async createAgent(compiled: CompiledAgent): Promise<AgentHandle> {
    const apiKey = process.env[compiled.model.apiKeyEnv];
    if (!apiKey) {
      throw new Error(
        `pi: ${compiled.model.apiKeyEnv} is not set — needed to reach ${compiled.model.baseUrl}`,
      );
    }

    const sdk = await import("@earendil-works/pi-coding-agent");

    // attachMcpServers applies the manifest's policy to whatever the servers
    // turn out to expose, so `mcp.tools` here is already filtered.
    const mcp = await attachMcpServers(compiled);
    const tools = indexByWireName([...compiled.tools, ...mcp.tools]);
    const approvalRequired = new Set([...compiled.approvalRequired, ...mcp.approvalRequired]);

    // Pi persists auth and model caches under a home directory. Point it at a
    // private temp dir so a build never reads or writes the operator's ~/.pi.
    const home = await mkdtemp(join(tmpdir(), "agent-builder-pi-"));

    let active: RunState | undefined;
    const cleanup: (() => Promise<void>)[] = [];

    try {
      const modelRuntime = await sdk.ModelRuntime.create({
        authPath: join(home, "auth.json"),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      const model = registerBuilderModel(modelRuntime, compiled, apiKey);

      const customTools = [...tools.entries()].map(([wire, tool]) =>
        sdk.defineTool({
          name: wire,
          label: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          execute: async (_toolCallId: string, params: Record<string, unknown>) => {
            const text = await dispatch(tool, params ?? {}, () => active, compiled, approvalRequired);
            return { content: [{ type: "text", text }], details: {} };
          },
        }),
      ) as ToolDefinition[];

      // Pi resolves cwd and agentDir eagerly and throws when either is
      // undefined, so both are always passed explicitly.
      const resourceLoader = new sdk.DefaultResourceLoader({
        cwd: process.cwd(),
        agentDir: join(home, "agent"),
        systemPromptOverride: () => compiled.systemPrompt,
      });
      await resourceLoader.reload();

      const { session } = await sdk.createAgentSession({
        cwd: process.cwd(),
        model,
        modelRuntime,
        sessionManager: sdk.SessionManager.inMemory(),
        resourceLoader,
        // Both are needed: `noTools` drops Pi's built-ins, `tools` pins the
        // surface to exactly what the Builder granted.
        noTools: "all",
        tools: [...tools.keys()],
        customTools,
      });
      cleanup.push(async () => session.dispose());

      const handle: PiHandle = {
        runtimeId: this.id,
        sessionId: `pi-${compiled.name}-${Date.now()}`,
        compiled,
        session,
        beginRun(ctx) {
          active = { ctx, trace: [], toolCalls: 0 };
          return active;
        },
        endRun() {
          active = undefined;
        },
        dispose: async () => {
          await Promise.allSettled([
            ...cleanup.map((fn) => fn()),
            ...mcp.connections.map((c: McpConnection) => c.close()),
            rm(home, { recursive: true, force: true }),
          ]);
        },
      };
      return handle;
    } catch (error) {
      // The session never reached a handle, so nothing else will dispose it.
      await Promise.allSettled([
        ...cleanup.map((fn) => fn()),
        ...mcp.connections.map((c: McpConnection) => c.close()),
        rm(home, { recursive: true, force: true }),
      ]);
      throw error;
    }
  }

  async run(agent: AgentHandle, input: string, ctx: RunContext): Promise<AgentResult> {
    const handle = agent as PiHandle;
    const { compiled, session } = handle;
    const state = handle.beginRun(ctx);

    const record = (kind: TraceEvent["kind"], detail: Record<string, unknown>) => {
      const event: TraceEvent = { at: new Date().toISOString(), kind, detail };
      state.trace.push(event);
      if (compiled.audit) ctx.onTrace(event);
    };

    let output = "";
    const unsubscribe = session.subscribe((event: unknown) => {
      const e = event as { type?: string; assistantMessageEvent?: { type?: string; delta?: string } };
      if (e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") {
        output += e.assistantMessageEvent.delta ?? "";
      }
    });

    try {
      record("model_call", { model: compiled.model.id, tools: compiled.tools.length });
      await session.prompt(input);

      const last = session.messages[session.messages.length - 1] as { errorMessage?: string } | undefined;
      if (last?.errorMessage) {
        record("error", { message: last.errorMessage });
        throw new Error(`pi: ${last.errorMessage}`);
      }

      record("finish", { toolCalls: state.toolCalls });
      return {
        output: output.trim(),
        sessionId: handle.sessionId,
        trace: state.trace,
        toolCalls: state.toolCalls,
      };
    } finally {
      unsubscribe();
      handle.endRun();
    }
  }

  async resume(sessionId: string): Promise<AgentHandle> {
    throw new Error(`PiRuntime.resume('${sessionId}') is not implemented (planned P5)`);
  }
}

/**
 * Register the Builder's ModelBinding as this runtime's only provider and
 * return the resolved model.
 *
 * This is the seam that keeps B1 honest on Pi: the base URL is whatever the
 * Model Registry decided (llm-gateway when configured), and the key is the
 * env var it named. Pi contributes transport, not model choice.
 */
function registerBuilderModel(
  modelRuntime: PiModelRuntime,
  compiled: CompiledAgent,
  apiKey: string,
) {
  modelRuntime.registerProvider(PROVIDER_ID, {
    name: "Agent Builder",
    baseUrl: compiled.model.baseUrl,
    apiKey,
    api: "openai-completions",
    models: [
      {
        id: compiled.model.id,
        name: compiled.model.id,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: DEFAULT_MAX_TOKENS,
      },
    ],
  });

  const model = modelRuntime.getModel(PROVIDER_ID, compiled.model.id);
  if (!model) {
    throw new Error(
      `pi: could not register model '${compiled.model.id}' from ${compiled.model.baseUrl}`,
    );
  }
  return model;
}

/**
 * Run one tool call: approval first, then the tool.
 *
 * Returns the text Pi should hand back to the model. A denial and a thrown
 * tool are both reported to the model as text rather than raised, because
 * throwing into Pi's loop ends the turn — the model should be able to say
 * what it needs instead of the run simply stopping.
 */
async function dispatch(
  tool: ResolvedTool,
  args: Record<string, unknown>,
  getState: () => RunState | undefined,
  compiled: CompiledAgent,
  approvalRequired: Set<string>,
): Promise<string> {
  const state = getState();
  if (!state) {
    // Pi only calls a tool inside a prompt, which only happens inside run().
    throw new Error(`pi: tool '${tool.name}' was called outside a run()`);
  }

  const record = (kind: TraceEvent["kind"], detail: Record<string, unknown>) => {
    const event: TraceEvent = { at: new Date().toISOString(), kind, detail };
    state.trace.push(event);
    if (compiled.audit) state.ctx.onTrace(event);
  };

  record("tool_call", { tool: tool.name, effect: tool.effect, args });

  if (approvalRequired.has(tool.name)) {
    const decision = await state.ctx.requestApproval({
      tool: tool.name,
      effect: tool.effect,
      args,
      reason: compiled.autonomy.allowedEffects.includes(tool.effect)
        ? "policy.humanApproval"
        : "autonomy.level",
    });
    record("approval", { tool: tool.name, decision });
    if (decision === "deny") {
      return `denied: a human declined '${tool.name}'. Do not retry it; continue without it or explain what you need.`;
    }
  }

  try {
    const result = await tool.execute(args);
    state.toolCalls += 1;
    record("tool_result", { tool: tool.name, chars: result.text.length });
    return result.text;
  } catch (error) {
    const message = (error as Error).message;
    record("error", { tool: tool.name, message });
    return `error: ${message}`;
  }
}
