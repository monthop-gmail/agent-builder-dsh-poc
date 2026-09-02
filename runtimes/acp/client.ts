import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

/**
 * Minimal Agent Client Protocol client: newline-delimited JSON-RPC over a
 * child process's stdio.
 *
 * Written against the protocol rather than an SDK on purpose. ACP is a
 * published spec with more than one implementation; binding to one vendor's
 * package would put this adapter back on the release train of a single
 * harness, which is the coupling the manifest exists to avoid.
 *
 * Stdout carries protocol traffic only — anything an agent logs there breaks
 * the stream, so agents write logs to stderr and this client forwards them.
 */

export type JsonRpcId = number | string;

export interface AgentRequest {
  id: JsonRpcId;
  method: string;
  params: Record<string, unknown>;
}

export interface AcpClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Notifications the agent pushes, e.g. `session/update`. */
  onNotification?(method: string, params: Record<string, unknown>): void;
  /** Requests the agent makes of us, e.g. `session/request_permission`. */
  onRequest?(request: AgentRequest): Promise<unknown>;
  onStderr?(chunk: string): void;
  /** Bound on every call, so a hung agent fails the run instead of it. */
  requestTimeoutMs?: number;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class AcpClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #reader: Interface;
  readonly #pending = new Map<JsonRpcId, Pending>();
  readonly #timeoutMs: number;
  #nextId = 1;
  #exit: { code: number | null; signal: string | null } | undefined;
  #stderrTail = "";

  constructor(private readonly options: AcpClientOptions) {
    this.#timeoutMs = options.requestTimeoutMs ?? 120_000;
    this.#child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (chunk: string) => {
      // Keep a bounded tail: when the agent dies, its last words are the
      // only useful part of the diagnostic.
      this.#stderrTail = `${this.#stderrTail}${chunk}`.slice(-4000);
      options.onStderr?.(chunk);
    });

    this.#child.on("exit", (code, signal) => {
      this.#exit = { code, signal };
      const reason = new Error(
        `acp: agent exited (code ${code ?? "null"}, signal ${signal ?? "null"})` +
          (this.#stderrTail ? `\n${this.#stderrTail.trim()}` : ""),
      );
      for (const [id, pending] of this.#pending) {
        clearTimeout(pending.timer);
        pending.reject(reason);
        this.#pending.delete(id);
      }
    });

    this.#reader = createInterface({ input: this.#child.stdout });
    this.#reader.on("line", (line) => this.#onLine(line));
  }

  #onLine(line: string): void {
    const text = line.trim();
    if (!text.startsWith("{")) return;

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // A malformed line is the agent's bug; dropping it keeps the stream
      // usable rather than killing a run that may still complete.
      return;
    }

    const id = message.id as JsonRpcId | undefined;
    const method = message.method as string | undefined;

    if (id !== undefined && method === undefined) {
      const pending = this.#pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(id);
      const error = message.error as { code?: number; message?: string } | undefined;
      if (error) pending.reject(new Error(`acp: ${error.code ?? ""} ${error.message ?? "error"}`.trim()));
      else pending.resolve(message.result);
      return;
    }

    if (method === undefined) return;
    const params = (message.params ?? {}) as Record<string, unknown>;

    if (id === undefined) {
      this.options.onNotification?.(method, params);
      return;
    }

    void this.#answer({ id, method, params });
  }

  async #answer(request: AgentRequest): Promise<void> {
    const handler = this.options.onRequest;
    if (!handler) {
      this.#send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `unhandled: ${request.method}` } });
      return;
    }
    try {
      const result = await handler(request);
      this.#send({ jsonrpc: "2.0", id: request.id, result });
    } catch (error) {
      this.#send({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32603, message: (error as Error).message },
      });
    }
  }

  #send(message: Record<string, unknown>): void {
    if (this.#exit) return;
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.#exit) {
      return Promise.reject(new Error(`acp: agent already exited (code ${this.#exit.code ?? "null"})`));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`acp: '${method}' timed out after ${this.#timeoutMs}ms`));
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async close(): Promise<void> {
    this.#reader.close();
    if (this.#exit) return;
    this.#child.stdin.end();
    // stdin EOF is the documented way to ask an ACP stdio server to stop.
    // SIGKILL is the backstop for one that ignores it.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.#child.kill("SIGKILL");
        resolve();
      }, 2_000);
      this.#child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
