import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stub OpenAI-compatible endpoint on 127.0.0.1.
 *
 * Both real adapters reach their model through `ModelBinding.baseUrl`, so
 * pointing that at this server exercises the actual runtime — the same
 * request shape, the same tool-call parsing, the same message threading it
 * would use against a live provider. That is what lets the conformance suite
 * run every adapter instead of skipping the ones that "need credentials":
 * a runtime nobody tests is a runtime nobody can trust.
 *
 * `dsh` posts plain JSON; `pi` streams. One server answers both, keyed on the
 * `stream` flag the caller sends.
 */

export interface StubRequest {
  model: string;
  stream: boolean;
  toolNames: string[];
  messageCount: number;
}

export interface StubCall {
  /** Wire name, i.e. the manifest name with dots replaced. */
  tool: string;
  arguments?: Record<string, unknown>;
}

export interface OpenAiStub {
  baseUrl: string;
  requests: StubRequest[];
  /**
   * Tool calls the stub should make, in order, before it settles on a text
   * reply. Entries whose tool is absent from a request's list are skipped, so
   * one queue works for manifests with different tool sets. Arguments matter:
   * Pi validates them against the schema the adapter handed it and never
   * reaches the tool when they do not match.
   */
  callQueue: StubCall[];
  text: string;
  reset(): void;
  close(): Promise<void>;
}

interface WireBody {
  model?: string;
  stream?: boolean;
  messages?: unknown[];
  tools?: { function?: { name?: string } }[];
}

export async function startOpenAiStub(): Promise<OpenAiStub> {
  const state = { callQueue: [] as StubCall[], text: "stub reply", requests: [] as StubRequest[] };

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = (raw ? JSON.parse(raw) : {}) as WireBody;
      const offered = (body.tools ?? []).map((t) => t.function?.name ?? "").filter(Boolean);
      state.requests.push({
        model: body.model ?? "",
        stream: body.stream === true,
        toolNames: offered,
        messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
      });

      // Take the next queued call the caller can actually make.
      let call: StubCall | undefined;
      while (state.callQueue.length && call === undefined) {
        const candidate = state.callQueue.shift() as StubCall;
        if (offered.includes(candidate.tool)) call = candidate;
      }

      if (body.stream === true) sendStream(res, body.model ?? "stub", call, state.text);
      else sendJson(res, call, state.text);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    get requests() {
      return state.requests;
    },
    get callQueue() {
      return state.callQueue;
    },
    set callQueue(next: StubCall[]) {
      state.callQueue = next;
    },
    get text() {
      return state.text;
    },
    set text(next: string) {
      state.text = next;
    },
    reset() {
      state.requests.length = 0;
      state.callQueue = [];
      state.text = "stub reply";
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function sendJson(
  res: ServerResponse,
  call: StubCall | undefined,
  text: string,
) {
  const message = call
    ? {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `call_${call.tool}`,
            type: "function",
            function: { name: call.tool, arguments: JSON.stringify(call.arguments ?? {}) },
          },
        ],
      }
    : { role: "assistant", content: text };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: "chatcmpl-stub",
      object: "chat.completion",
      choices: [{ index: 0, message, finish_reason: call ? "tool_calls" : "stop" }],
    }),
  );
}

function sendStream(
  res: ServerResponse,
  model: string,
  call: StubCall | undefined,
  text: string,
) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const id = "chatcmpl-stub";
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    res.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`,
    );

  chunk({ role: "assistant" }, null);
  if (call) {
    chunk(
      {
        tool_calls: [
          { index: 0, id: `call_${call.tool}`, type: "function", function: { name: call.tool, arguments: "" } },
        ],
      },
      null,
    );
    // Arguments arrive as a separate delta, the way real providers stream them.
    chunk(
      { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(call.arguments ?? {}) } }] },
      null,
    );
    chunk({}, "tool_calls");
  } else {
    chunk({ content: text }, null);
    chunk({}, "stop");
  }
  res.write("data: [DONE]\n\n");
  res.end();
}
