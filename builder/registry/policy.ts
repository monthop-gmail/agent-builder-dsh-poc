import type { AutonomyPolicy, CompiledAgent, ResolvedTool, ToolEffect } from "../types.js";

/**
 * Policy Registry — autonomy levels and the forbidden-capability filter.
 *
 * Enforcement happens HERE, in the Builder, not in the runtime. A runtime
 * that forgets to check a policy would silently become a bypass, and every
 * new adapter would be one more chance to forget. Instead the Builder simply
 * does not hand a forbidden tool to the runtime: there is nothing to call.
 */

export interface AutonomyLevel {
  level: number;
  name: string;
  summary: string;
  allowedEffects: ToolEffect[];
}

/**
 * The levels `spec.autonomy.level` refers to. `allowedEffects` is what the
 * agent may do on its own; anything else becomes an approval request.
 */
export const AUTONOMY_LEVELS: AutonomyLevel[] = [
  {
    level: 0,
    name: "observe",
    summary: "อ่านอย่างเดียว ทุก action ต้องขออนุมัติจากคน",
    allowedEffects: [],
  },
  {
    level: 1,
    name: "read",
    summary: "เรียก tool ที่ไม่มี side effect ได้เอง",
    allowedEffects: ["read"],
  },
  {
    level: 2,
    name: "propose",
    summary: "เขียนสิ่งที่ย้อนกลับได้เอง (comment, draft) — irreversible ต้องขออนุมัติ",
    allowedEffects: ["read", "write"],
  },
  {
    level: 3,
    name: "act",
    summary: "ทำได้ทุกอย่างที่ไม่ติด policy.forbidden หรือ humanApproval",
    allowedEffects: ["read", "write", "irreversible"],
  },
];

export function isKnownAutonomyLevel(level: number): boolean {
  return AUTONOMY_LEVELS.some((l) => l.level === level);
}

export function autonomyFor(level: number): AutonomyPolicy {
  const found = AUTONOMY_LEVELS.find((l) => l.level === level);
  if (!found) {
    throw new Error(
      `autonomy: unknown level ${level} (known: ${AUTONOMY_LEVELS.map((l) => l.level).join(", ")})`,
    );
  }
  return { level: found.level, allowedEffects: found.allowedEffects };
}

export interface CapabilityDecision {
  /** Tools the runtime will receive. */
  granted: ResolvedTool[];
  /** Dropped because `policy.forbidden` names them. */
  forbidden: string[];
  /**
   * Dropped because a capability they need is denied — `{tool, capability}`.
   *
   * Reported apart from `forbidden` because it answers a different question.
   * "Someone named this tool" and "this tool needs something nobody may use
   * here" are different facts, and only the second one travels between
   * namespaces.
   */
  deniedByCapability: { tool: string; capability: string }[];
  /** Granted, but each call raises an approval request first. */
  approvalRequired: string[];
}

/**
 * Turn "allowed" + "forbidden" + autonomy into the exact set of tools the
 * runtime gets, plus which of them still need a human on every call.
 */
export function decideCapabilities(input: {
  allowed: ResolvedTool[];
  forbidden: string[];
  autonomy: AutonomyPolicy;
  humanApproval: string[];
  deniedCapabilities?: string[];
}): CapabilityDecision {
  const forbidden = new Set(input.forbidden);
  const deniedCapabilities = new Set(input.deniedCapabilities ?? []);

  // ADR-0026 rule 2: a tool whose required capabilities intersect anyone's
  // deny list is unusable. This is the half of the ceiling that survives a
  // rename — the platform never has to know what our registry calls things,
  // only what they need.
  const deniedByCapability: { tool: string; capability: string }[] = [];
  const withinCapabilities = input.allowed.filter((t) => {
    const blocked = (t.capabilities ?? []).find((c) => deniedCapabilities.has(c));
    if (blocked === undefined) return true;
    deniedByCapability.push({ tool: t.name, capability: blocked });
    return false;
  });

  const granted = withinCapabilities.filter((t) => !forbidden.has(t.name));

  const approvalRequired = granted
    .filter(
      (t) =>
        input.humanApproval.includes(t.name) || !input.autonomy.allowedEffects.includes(t.effect),
    )
    .map((t) => t.name);

  return {
    granted,
    forbidden: withinCapabilities.filter((t) => forbidden.has(t.name)).map((t) => t.name),
    deniedByCapability,
    approvalRequired,
  };
}

/**
 * Apply the same policy to tools that only appear at connect time.
 *
 * An MCP server does not announce its tools until a client connects, so they
 * cannot be filtered during compile. Routing them through this one function —
 * from `mcp-client.ts`, which is the only place any adapter obtains MCP tools —
 * keeps "forbidden means unreachable" true for them too, without asking every
 * adapter author to remember.
 */
export function admitLateTools(
  compiled: Pick<CompiledAgent, "policy" | "autonomy">,
  discovered: ResolvedTool[],
): CapabilityDecision {
  return decideCapabilities({
    allowed: discovered,
    forbidden: compiled.policy.forbidden,
    autonomy: compiled.autonomy,
    humanApproval: compiled.policy.humanApproval,
    deniedCapabilities: compiled.policy.deniedCapabilities,
  });
}
