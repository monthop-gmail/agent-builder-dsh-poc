/**
 * Capability Gap Registry — what an adapter's `unsupported()` names mean, and
 * whether a run may proceed anyway.
 *
 * `unsupported()` returns bare strings so an adapter stays free to be honest
 * without asking permission first. Severity is decided here instead, in one
 * place, because it is a property of the *manifest's* promise rather than of
 * any adapter: two runtimes failing the same way must be refused the same
 * way.
 *
 * The rule that decides severity:
 *
 *   A gap that removes a RESTRICTION blocks the run.
 *   A gap that removes a CAPABILITY only warns.
 *
 * `spec.policy` and `spec.humanApproval` narrow what the agent may do; an
 * operator reads them as a guarantee. A runtime that cannot honour one does
 * not give a degraded agent, it gives an agent that is allowed to do the
 * thing the manifest forbade — so running is the wrong default.
 *
 * `spec.tools`, audit fidelity and model fallbacks widen what the agent can
 * do or how well it reports. Losing one leaves the agent less useful, never
 * less contained, and refusing would only push people to delete the field.
 */

export type GapSeverity = "blocks" | "degrades";

export interface CapabilityGap {
  severity: GapSeverity;
  /** Shown to whoever has to decide what to do about it. */
  meaning: string;
}

const GAPS: Record<string, CapabilityGap> = {
  "policy.forbidden": {
    severity: "blocks",
    meaning:
      "the manifest forbids tools this target cannot withhold — the agent can reach them anyway",
  },
  "policy.humanApproval": {
    severity: "blocks",
    meaning: "this target cannot ask a human before a gated tool runs",
  },
  "tools.local": {
    severity: "degrades",
    meaning: "granted tools defined here cannot cross into this target; only MCP capability does",
  },
  "mcp.connect": {
    severity: "degrades",
    meaning: "MCP servers are listed but never dialled, so their tools are absent",
  },
  "trace.model_step": {
    severity: "degrades",
    meaning: "the audit trail records the turn and its tool calls, but not each model step",
  },
  "model.fallback": {
    severity: "degrades",
    meaning: "only the first entry of spec.model.preferred is reachable",
  },
};

export interface GapReport {
  blocking: { name: string; meaning: string }[];
  degrading: { name: string; meaning: string }[];
  /**
   * Names no one has classified. Treated as blocking: an adapter that invents
   * a gap name should not be able to downgrade its own severity by doing so.
   */
  unknown: string[];
}

export function classifyGaps(names: string[]): GapReport {
  const report: GapReport = { blocking: [], degrading: [], unknown: [] };
  for (const name of names) {
    const gap = GAPS[name];
    if (!gap) report.unknown.push(name);
    else if (gap.severity === "blocks") report.blocking.push({ name, meaning: gap.meaning });
    else report.degrading.push({ name, meaning: gap.meaning });
  }
  return report;
}

/** True when the run must be refused rather than warned about. */
export function refusesRun(report: GapReport): boolean {
  return report.blocking.length > 0 || report.unknown.length > 0;
}

export function listGapNames(): string[] {
  return Object.keys(GAPS).sort();
}
