import type {
  AgentHandle,
  AgentResult,
  AgentRuntime,
  CompiledAgent,
  RunContext,
  TraceEvent,
} from "../../builder/types.js";

/**
 * MockRuntime — proves the whole pipeline with no credentials and no network.
 *
 * It is a real AgentRuntime, not a stub, which is what lets CI run the
 * conformance suite and the portability test on every push.
 */
interface MockHandle extends AgentHandle {
  compiled: CompiledAgent;
}

export class MockRuntime implements AgentRuntime {
  readonly id = "mock";

  unsupported(compiled: CompiledAgent): string[] {
    // Honest about its limits: it lists MCP servers but never dials them.
    return compiled.mcpServers.length ? ["mcp.connect"] : [];
  }

  async createAgent(compiled: CompiledAgent): Promise<AgentHandle> {
    const handle: MockHandle = {
      runtimeId: this.id,
      sessionId: `mock-${compiled.name}-${Date.now()}`,
      compiled,
      dispose: async () => {},
    };
    return handle;
  }

  async run(agent: AgentHandle, input: string, ctx: RunContext): Promise<AgentResult> {
    const { compiled } = agent as MockHandle;
    const trace: TraceEvent[] = [];
    const record = (event: TraceEvent) => {
      trace.push(event);
      if (compiled.audit) ctx.onTrace(event);
    };

    record({ at: new Date().toISOString(), kind: "model_call", detail: { model: compiled.model.id } });

    // Exercise the approval path so the conformance suite can assert on it:
    // call the first gated tool, if the agent has one.
    let toolCalls = 0;
    const gated = compiled.tools.find((t) => compiled.approvalRequired.includes(t.name));
    if (gated) {
      const decision = await ctx.requestApproval({
        tool: gated.name,
        effect: gated.effect,
        args: {},
        reason: compiled.autonomy.allowedEffects.includes(gated.effect)
          ? "policy.humanApproval"
          : "autonomy.level",
      });
      record({ at: new Date().toISOString(), kind: "approval", detail: { tool: gated.name, decision } });
      if (decision === "allow") toolCalls += 1;
    }

    const lines = [
      `[mock:${compiled.name}@${compiled.version}] received: ${input}`,
      `purpose: ${compiled.purpose}`,
      `model: ${compiled.model.requested} -> ${compiled.model.id} via ${compiled.model.route}`,
      `autonomy: level ${compiled.autonomy.level} (${compiled.autonomy.allowedEffects.join("/") || "none"})`,
      `tools granted: ${compiled.tools.map((t) => `${t.name}:${t.effect}`).join(", ") || "none"}`,
      `approval required: ${compiled.approvalRequired.join(", ") || "none"}`,
      `skills: ${compiled.skills.map((s) => s.name).join(", ") || "none"}`,
      `mcp declared: ${compiled.mcpServers.map((m) => m.name).join(", ") || "none"}`,
      `system prompt: ${compiled.systemPrompt.split("\n").length} lines`,
    ];

    record({ at: new Date().toISOString(), kind: "finish", detail: { toolCalls } });
    return { output: lines.join("\n"), sessionId: agent.sessionId, trace, toolCalls };
  }

  async resume(sessionId: string): Promise<AgentHandle> {
    throw new Error(`MockRuntime.resume('${sessionId}') is not implemented (planned P5)`);
  }
}
