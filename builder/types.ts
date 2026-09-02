/**
 * Core, runtime-neutral types.
 *
 * Nothing in this file may import from a runtime. Runtimes are reached only
 * through the `AgentRuntime` interface below, and they receive a
 * `CompiledAgent` — never a raw Manifest. That one rule is what makes
 * "swap the runtime without touching the manifest" true by construction
 * rather than by discipline.
 */

/**
 * How much damage a tool can do. The Builder uses this to enforce
 * `spec.autonomy.level` — a tool the level does not permit is never handed
 * to the runtime at all.
 */
export type ToolEffect = "read" | "write" | "irreversible";

export interface ResolvedTool {
  name: string;
  description: string;
  effect: ToolEffect;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<{ text: string }>;
}

export interface ResolvedSkill {
  name: string;
  description: string;
  instructions: string;
}

export interface McpServerRef {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

/**
 * Where the model actually lives. Produced by the Model Registry, never
 * written in a manifest — a manifest says `preferred: [deepseek]` and the
 * registry decides whether that resolves through llm-gateway or direct.
 */
export interface ModelBinding {
  /** Name the manifest asked for. */
  requested: string;
  /** Model id to send on the wire. */
  id: string;
  /** OpenAI-compatible base URL, no trailing slash. */
  baseUrl: string;
  /** Env var holding the bearer token. */
  apiKeyEnv: string;
  /** "gateway" honours ecosystem boundary B1; "direct" bypasses it. */
  route: "gateway" | "direct";
}

export interface AutonomyPolicy {
  level: number;
  /** Effects the agent may invoke without asking a human. */
  allowedEffects: ToolEffect[];
}

/** Runtime-neutral agent definition produced by the Compiler. */
export interface CompiledAgent {
  name: string;
  version: string;
  description: string;
  purpose: string;
  model: ModelBinding;
  systemPrompt: string;
  /** Already filtered: forbidden removed, autonomy applied. */
  tools: ResolvedTool[];
  skills: ResolvedSkill[];
  mcpServers: McpServerRef[];
  autonomy: AutonomyPolicy;
  /** Tool names that always need a human yes, whatever the autonomy level. */
  approvalRequired: string[];
  audit: boolean;
  /** sha256 of the manifest bytes. Identical across every build target. */
  manifestChecksum: string;
}

/* ---------- execution ---------- */

export interface ApprovalRequest {
  tool: string;
  effect: ToolEffect;
  args: Record<string, unknown>;
  reason: "policy.humanApproval" | "autonomy.level";
}

export type ApprovalDecision = "allow" | "deny";

export interface TraceEvent {
  at: string;
  kind: "model_call" | "tool_call" | "tool_result" | "approval" | "error" | "finish";
  detail: Record<string, unknown>;
}

export interface RunContext {
  /** Called for every tool the compiled agent flags as needing a human. */
  requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
  /** Called for every trace event when `audit` is on. */
  onTrace(event: TraceEvent): void;
}

export interface AgentResult {
  output: string;
  sessionId?: string;
  trace: TraceEvent[];
  toolCalls: number;
}

export interface AgentHandle {
  readonly runtimeId: string;
  readonly sessionId?: string;
  dispose(): Promise<void>;
}

/**
 * The seam between Builder and any execution engine.
 *
 * Note what is NOT here: no `validate(manifest)` and no `compile(manifest)`.
 * A runtime that can read a manifest can grow manifest-specific behaviour,
 * and portability dies quietly. Adapters declare what they cannot do via
 * `unsupported()` instead.
 */
export interface AgentRuntime {
  readonly id: string;
  /** Capability names this adapter cannot honour for the given agent. Empty = fully supported. */
  unsupported(compiled: CompiledAgent): string[];
  createAgent(compiled: CompiledAgent): Promise<AgentHandle>;
  run(agent: AgentHandle, input: string, ctx: RunContext): Promise<AgentResult>;
  resume(sessionId: string): Promise<AgentHandle>;
}
