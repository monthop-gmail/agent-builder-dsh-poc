import type {
  AgentHandle,
  AgentResult,
  AgentRuntime,
  CompiledAgent,
  McpServerRef,
  RunContext,
  ToolEffect,
  TraceEvent,
} from "../../builder/types.js";
import { RunAborted } from "../../builder/errors.js";
import { AcpClient, type AgentRequest } from "./client.js";

/**
 * AcpRuntime — drive any agent that speaks the Agent Client Protocol.
 *
 * This is the first adapter that does not run the agent: it runs a *client*.
 * The agent is somebody else's process with its own tools, its own loop and
 * its own model. What that buys is the one capability no adapter here had —
 * `session/resume` — and what it costs is honest to declare rather than
 * paper over:
 *
 *   - The Builder's local tools cannot cross the boundary. ACP passes
 *     capability through MCP servers; there is no client-tool channel. A
 *     manifest that grants `web_search` gets an agent that does not have it.
 *   - `policy.forbidden` cannot be enforced on MCP tools. `session/new`
 *     hands the agent a whole server, not a chosen subset, and the agent
 *     also keeps its own built-ins. Measured against a real ACP agent, a
 *     session that mounted one MCP server offered 40 tools including a shell
 *     and every tool the manifest had forbidden.
 *
 * Both are reported through `unsupported()`. An adapter that stayed quiet
 * about them would let a manifest look enforced when it is not, which is
 * worse than not supporting the target at all.
 */

/** Where to find the agent, and anything that had to be written first. */
export interface AgentLaunch {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  /** Called on dispose, after the client is closed. */
  cleanup?(): Promise<void>;
}

/**
 * How a target decides what to launch.
 *
 * `acp` reads it from the environment: the agent is somebody else's, already
 * installed, and nothing here configures it. A target that composes its
 * agent — `dsh` writes a Cordis patch first — supplies its own launcher and
 * inherits every line of protocol handling below.
 */
export interface AcpLauncher {
  prepare(compiled: CompiledAgent): Promise<AgentLaunch>;
}

/** The default: name the agent in the environment, configure nothing. */
export class EnvLauncher implements AcpLauncher {
  async prepare(): Promise<AgentLaunch> {
    const command = process.env.ACP_AGENT_COMMAND;
    if (!command) {
      throw new Error(
        "acp: ACP_AGENT_COMMAND is not set — name the ACP agent to launch, " +
          'e.g. ACP_AGENT_COMMAND=dsh ACP_AGENT_ARGS="--profile acp"',
      );
    }
    const raw = process.env.ACP_AGENT_ARGS ?? "";
    return { command, args: raw.split(" ").filter(Boolean) };
  }
}

interface AcpHandle extends AgentHandle {
  compiled: CompiledAgent;
  client: AcpClient;
  /** Set for the duration of run(); the permission handler reads it. */
  active: RunState | undefined;
  /** Whatever the launcher wrote and now has to remove. */
  cleanup?(): Promise<void>;
}

interface RunState {
  ctx: RunContext;
  trace: TraceEvent[];
  toolCalls: number;
  output: string;
}

export class AcpRuntime implements AgentRuntime {
  readonly id: string = "acp";

  constructor(protected readonly launcher: AcpLauncher = new EnvLauncher()) {}

  unsupported(compiled: CompiledAgent): string[] {
    const gaps: string[] = [];
    if (compiled.tools.length) gaps.push("tools.local");
    if (compiled.policy.forbidden.length) gaps.push("policy.forbidden");
    return gaps;
  }

  async createAgent(compiled: CompiledAgent): Promise<AgentHandle> {
    const handle = await this.connect(compiled);
    const session = (await handle.client.call("session/new", {
      cwd: process.cwd(),
      mcpServers: compiled.mcpServers.map(toAcpMcpServer),
    })) as { sessionId?: string };

    if (!session.sessionId) {
      await handle.client.close();
      throw new Error("acp: session/new returned no sessionId");
    }
    return withSession(handle, this.id, session.sessionId);
  }

  async resume(compiled: CompiledAgent, sessionId: string): Promise<AgentHandle> {
    const handle = await this.connect(compiled);
    try {
      // Policy travels with the CompiledAgent, so a resumed session is gated
      // by the manifest as it reads today — not as it read when the session
      // started.
      await handle.client.call("session/resume", { sessionId, cwd: process.cwd() });
    } catch (error) {
      await handle.client.close();
      throw error;
    }
    return withSession(handle, this.id, sessionId);
  }

  async run(agent: AgentHandle, input: string, ctx: RunContext): Promise<AgentResult> {
    const handle = agent as AcpHandle;
    const { compiled } = handle;
    const state: RunState = { ctx, trace: [], toolCalls: 0, output: "" };
    handle.active = state;

    const record = (kind: TraceEvent["kind"], detail: Record<string, unknown>) => {
      const event: TraceEvent = { at: new Date().toISOString(), kind, detail };
      state.trace.push(event);
      if (compiled.audit) ctx.onTrace(event);
    };

    try {
      record("model_call", { model: compiled.model.id, session: handle.sessionId });
      const result = (await handle.client.call("session/prompt", {
        sessionId: handle.sessionId,
        prompt: [{ type: "text", text: input }],
      })) as { stopReason?: string };

      record("finish", { stopReason: result.stopReason ?? "unknown", toolCalls: state.toolCalls });
      return {
        output: state.output.trim(),
        sessionId: handle.sessionId,
        trace: state.trace,
        toolCalls: state.toolCalls,
      };
    } catch (error) {
      record("error", { message: (error as Error).message });
      throw new RunAborted(`acp: ${(error as Error).message}`, {
        output: state.output.trim(),
        sessionId: handle.sessionId,
        trace: state.trace,
        toolCalls: state.toolCalls,
      });
    } finally {
      handle.active = undefined;
    }
  }

  protected async connect(compiled: CompiledAgent): Promise<AcpHandle> {
    const launch = await this.launcher.prepare(compiled);
    // The handle is built before the client so the callbacks can reach it;
    // `active` is what makes a permission request find the current run.
    const handle = { compiled, active: undefined } as AcpHandle;

    const client = new AcpClient({
      command: launch.command,
      args: launch.args,
      cwd: process.cwd(),
      env: launch.env ?? process.env,
      onNotification: (method, params) => onNotification(handle, method, params),
      onRequest: (request) => onRequest(handle, request),
    });
    handle.client = client;

    try {
      await client.call("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
    } catch (error) {
      await client.close();
      await launch.cleanup?.();
      throw error;
    }
    handle.cleanup = launch.cleanup;
    return handle;
  }
}

function withSession(handle: AcpHandle, runtimeId: string, sessionId: string): AcpHandle {
  return Object.assign(handle, {
    runtimeId,
    sessionId,
    dispose: async () => {
      // Closing the session leaves it resumable; closing the client does not
      // delete it. That is the whole point of this target.
      await handle.client.call("session/close", { sessionId }).catch(() => undefined);
      await handle.client.close();
      await handle.cleanup?.();
    },
  });
}

/** Manifest MCP descriptor -> the ACP wire shape. */
function toAcpMcpServer(ref: McpServerRef): Record<string, unknown> {
  if (ref.transport === "http") {
    return {
      type: "http",
      name: ref.name,
      url: ref.url,
      headers: Object.entries(ref.headers ?? {}).map(([name, value]) => ({ name, value })),
    };
  }
  return {
    name: ref.name,
    command: ref.command,
    args: ref.args ?? [],
    env: [],
  };
}

function onNotification(handle: AcpHandle, method: string, params: Record<string, unknown>): void {
  const state = handle.active;
  if (!state || method !== "session/update") return;

  const update = (params.update ?? {}) as Record<string, unknown>;
  const kind = String(update.sessionUpdate ?? "");
  const record = (traceKind: TraceEvent["kind"], detail: Record<string, unknown>) => {
    const event: TraceEvent = { at: new Date().toISOString(), kind: traceKind, detail };
    state.trace.push(event);
    if (handle.compiled.audit) state.ctx.onTrace(event);
  };

  if (kind === "agent_message_chunk") {
    const content = (update.content ?? {}) as { text?: string };
    state.output += content.text ?? "";
    return;
  }
  if (kind === "tool_call") {
    record("tool_call", { tool: toolName(update), status: update.status ?? "pending" });
    return;
  }
  if (kind === "tool_call_update" && update.status === "completed") {
    state.toolCalls += 1;
    record("tool_result", { tool: toolName(update), status: "completed" });
  }
}

async function onRequest(handle: AcpHandle, request: AgentRequest): Promise<unknown> {
  if (request.method !== "session/request_permission") {
    throw new Error(`unsupported client method '${request.method}'`);
  }

  const state = handle.active;
  const options = (request.params.options ?? []) as { optionId: string; kind: string }[];
  const allow = options.find((option) => option.kind.startsWith("allow"));
  const reject = options.find((option) => option.kind.startsWith("reject")) ?? options[0];

  // Outside a run there is nobody to ask, so the answer is no. Failing closed
  // is the only safe default for a gate whose decider is absent.
  if (!state || !allow) {
    return { outcome: { outcome: "selected", optionId: (reject ?? allow)?.optionId } };
  }

  const toolCall = (request.params.toolCall ?? {}) as Record<string, unknown>;
  const tool = toolName(toolCall);
  const effect = effectFor(handle.compiled, tool);

  const decision = await state.ctx.requestApproval({
    tool,
    effect,
    args: (toolCall.rawInput ?? {}) as Record<string, unknown>,
    reason: handle.compiled.approvalRequired.includes(tool)
      ? "policy.humanApproval"
      : "autonomy.level",
  });

  const event: TraceEvent = {
    at: new Date().toISOString(),
    kind: "approval",
    detail: { tool, decision },
  };
  state.trace.push(event);
  if (handle.compiled.audit) state.ctx.onTrace(event);

  const chosen = decision === "allow" ? allow : (reject ?? allow);
  return { outcome: { outcome: "selected", optionId: chosen.optionId } };
}

function toolName(update: Record<string, unknown>): string {
  const raw = (update.rawInput ?? {}) as { name?: string };
  return String(update.title ?? raw.name ?? update.toolCallId ?? "(unnamed)");
}

/**
 * What the agent is about to do, as far as the manifest can tell.
 *
 * The agent's tools are not the Builder's, so a name usually will not match.
 * An unknown tool is treated as `write`: under-privileging a call is
 * recoverable, over-privileging it is not.
 */
function effectFor(compiled: CompiledAgent, tool: string): ToolEffect {
  return compiled.tools.find((candidate) => candidate.name === tool)?.effect ?? "write";
}
