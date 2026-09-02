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
  /**
   * Per-tool effect, for servers whose surface we know. MCP does not report
   * whether a tool mutates anything, so anything not listed here falls back
   * to a name heuristic and then to "write" — under-privileging a tool is
   * recoverable, over-privileging it is not.
   */
  toolEffects?: Record<string, ToolEffect>;
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
  /**
   * The rest of `spec.model.preferred`, in order, for a runtime that can move
   * on when the first endpoint keeps refusing. Empty when the manifest named
   * one model. An adapter that cannot use these says so via `unsupported()`
   * rather than pretending the manifest got what it asked for.
   */
  modelFallbacks: ModelBinding[];
  systemPrompt: string;
  /** Already filtered: forbidden removed, autonomy applied. */
  tools: ResolvedTool[];
  skills: ResolvedSkill[];
  mcpServers: McpServerRef[];
  autonomy: AutonomyPolicy;
  /** Tool names that always need a human yes, whatever the autonomy level. */
  approvalRequired: string[];
  /**
   * The raw policy, carried so that tools discovered AFTER compile time —
   * MCP servers only report their tools once connected — get filtered by the
   * same rules instead of slipping in ungoverned.
   */
  policy: {
    /** EFFECTIVE deny list — the agent's own union the platform ceiling's. */
    forbidden: string[];
    humanApproval: string[];
    /** `agent/v1` `policy.deny_capabilities`, likewise already unioned. */
    deniedCapabilities: string[];
  };
  /**
   * Which platform profile shaped `policy`, when one was supplied.
   *
   * ⚠️ Recorded but NOT part of `manifestChecksum`. ADR-0022 warns that a
   * deny-list compiled into a build artifact belongs inside that artifact's
   * identity, and ADR-0023 says the same about a frozen model binding — both
   * wait on the answer to `agent-platform#52`. Until then this field is
   * provenance, not identity, and `docs/effective-policy.md` says so where a
   * reader will see it.
   */
  policySource?: { profileId: string; profileChecksum: string };
  audit: boolean;
  /**
   * sha256 of the manifest bytes. Identical across every build target.
   *
   * Answers *"same source?"* — and only that. Two builds of one manifest can
   * still differ, because the model catalog and the platform profile live
   * outside the manifest. Use `buildIdentity` to ask *"same agent?"*.
   */
  manifestChecksum: string;
  /**
   * sha256 over the manifest checksum, the frozen model chain **in order**,
   * the effective policy, and the profile that shaped it.
   *
   * This is the identity `agent-platform` ADR-0023 rule 3 requires of anything
   * that freezes a binding, with "binding" meaning the whole chain including
   * its order (ADR-0025) — swapping two fallbacks is a different agent under
   * the same failure. Identical across build targets, like `manifestChecksum`.
   */
  buildIdentity: string;
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
  kind: "model_call" | "tool_call" | "tool_result" | "approval" | "retry" | "error" | "finish";
  detail: Record<string, unknown>;
}

export interface RunContext {
  /** Called for every tool the compiled agent flags as needing a human. */
  requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
  /** Called for every trace event when `audit` is on. */
  onTrace(event: TraceEvent): void;
}

/**
 * A category from `agent-platform` `error/v1` `$defs.Category`.
 *
 * Only the members a provider switch can be caused by. ADR-0025 chose to
 * reuse this enum rather than mint a new one, so we borrow the same subset
 * instead of inventing our own words for the same three facts.
 */
export type SwitchReason = "rate_limited" | "timeout" | "provider_error";

/**
 * One mid-run move to a different provider — the shape of
 * `execution/v1.provider_switches` (ADR-0025).
 *
 * `from` is nullable there because a switch can leave a native runtime that
 * has no provider id; ours always has one, but the field keeps the shape so
 * a caller can hand it straight to an execution record.
 */
export interface ProviderSwitch {
  from?: string | null;
  to: string;
  at: string;
  reason?: SwitchReason;
}

export interface AgentResult {
  output: string;
  sessionId?: string;
  trace: TraceEvent[];
  toolCalls: number;
  /**
   * Which provider was in effect when the run ended.
   *
   * `execution/v1.provider_id` means *"ตัวที่มีผลล่าสุด ไม่ใช่ตัวเดียวที่เคยใช้"* —
   * reading it alone after a switch gives an incomplete truth, which is why
   * `providerSwitches` exists beside it.
   */
  providerId?: string;
  /**
   * Every provider move that happened, in order.
   *
   * **Absent means it never switched.** An empty array is not a valid value —
   * `execution/v1` sets `minItems: 1` for exactly this reason, so that "did
   * not happen" and "was not recorded" cannot be written the same way.
   *
   * ⚠️ A run that switched cannot have its token usage costed by summing:
   * the totals mix providers billing at different rates. ADR-0025 wrote that
   * down as a rule rather than inventing a per-provider usage shape for work
   * nobody is doing yet.
   */
  providerSwitches?: ProviderSwitch[];
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
  /**
   * Re-attach to a session the runtime persisted earlier.
   *
   * The CompiledAgent is required, not optional: a session id carries no
   * policy. Resuming from an id alone would produce a handle whose approval
   * rules and granted tools came from wherever the runtime happened to store
   * them, which is precisely the enforcement the Builder exists to own. The
   * manifest is re-compiled and re-applied on every resume.
   */
  resume(compiled: CompiledAgent, sessionId: string): Promise<AgentHandle>;
}
