import type { AgentResult } from "./types.js";

/**
 * A run that stopped before the agent finished, carrying what already
 * happened.
 *
 * The reason this exists: a run can fail *after* a tool has run. During the
 * PoC an agent posted a message to a shared workspace and then the provider
 * returned 502 on the next step — the message was live, and the CLI printed
 * "run failed". Anyone reading that would conclude nothing had happened.
 *
 * Adapters therefore raise this instead of a bare Error, so the caller can
 * report the side effects that already landed.
 */
export class RunAborted extends Error {
  readonly result: AgentResult;

  constructor(message: string, result: AgentResult) {
    super(message);
    this.name = "RunAborted";
    this.result = result;
  }
}

/** Tools whose execution completed, in order, taken from a run's trace. */
export function executedTools(result: AgentResult): string[] {
  return result.trace
    .filter((event) => event.kind === "tool_result")
    .map((event) => String(event.detail.tool ?? "(unnamed)"));
}
