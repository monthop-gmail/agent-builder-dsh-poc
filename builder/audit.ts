import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import type { CompiledAgent, TraceEvent } from "./types.js";

/**
 * Durable audit trail for one run.
 *
 * `spec.audit.required: true` used to switch on an in-memory callback and
 * nothing else: with no `--trace` the record existed only for the length of
 * the process. For an agent allowed to write to a shared workspace that is
 * the wrong side of the line — the manifest promised an audit and the system
 * kept nothing.
 *
 * The format is JSON Lines so a run can be appended to while it happens and
 * read back with `grep`: one `run` line naming what was executed, then one
 * `event` line per trace event, all sharing a `runId`.
 */

export interface AuditSink {
  readonly runId: string;
  record(event: TraceEvent): void;
  /** Flush and report the first write error, if any. */
  close(): Promise<void>;
}

export interface AuditContext {
  agent: CompiledAgent;
  target: string;
  input: string;
}

export async function openAuditLog(path: string, context: AuditContext): Promise<AuditSink> {
  const runId = randomUUID();
  const { agent } = context;

  // Writes are serialised through one promise chain: trace events arrive
  // while the run is in flight, and interleaved appends would shuffle the
  // order that makes the log readable.
  let queue = Promise.resolve();
  let failure: Error | undefined;

  const write = (line: unknown) => {
    queue = queue
      .then(() => appendFile(path, `${JSON.stringify(line)}\n`, "utf8"))
      .catch((error: Error) => {
        failure ??= error;
      });
  };

  write({
    type: "run",
    runId,
    at: new Date().toISOString(),
    target: context.target,
    agent: `${agent.name}@${agent.version}`,
    manifestChecksum: agent.manifestChecksum,
    model: { requested: agent.model.requested, id: agent.model.id, route: agent.model.route },
    autonomy: agent.autonomy.level,
    input: context.input,
  });

  return {
    runId,
    record(event) {
      write({ type: "event", runId, ...event });
    },
    async close() {
      await queue;
      if (failure) throw new Error(`audit log ${path}: ${failure.message}`);
    },
  };
}
