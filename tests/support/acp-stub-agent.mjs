// A minimal ACP agent, for testing the client half.
//
// It persists its sessions to ACP_STUB_STATE so that `session/resume` is a
// real test: the adapter spawns a fresh process to resume, exactly as it
// would against a live agent, and a session that only lived in memory would
// not survive that.
//
// Behaviour is steered by the environment so one binary covers every case:
//   ACP_STUB_TEXT   final assistant text (default "stub agent reply")
//   ACP_STUB_TOOL   name of a tool call to perform; asks permission first
//   ACP_STUB_FAIL   method name to answer with a JSON-RPC error
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const statePath = process.env.ACP_STUB_STATE;
const text = process.env.ACP_STUB_TEXT ?? "stub agent reply";
const toolName = process.env.ACP_STUB_TOOL;
const failMethod = process.env.ACP_STUB_FAIL;

const load = () => {
  if (!statePath) return { sessions: [] };
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return { sessions: [] };
  }
};
const save = (state) => {
  if (statePath) writeFileSync(statePath, JSON.stringify(state), "utf8");
};

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
const update = (sessionId, body) => notify("session/update", { sessionId, update: body });

let nextRequestId = 1;
const pending = new Map();

/** Ask the client something and wait for its answer. */
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = `agent-${nextRequestId++}`;
    pending.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
  });

async function handle(method, params) {
  if (failMethod && method === failMethod) throw new Error(`stub refuses ${method}`);

  if (method === "initialize") {
    return {
      protocolVersion: 1,
      agentCapabilities: {
        mcpCapabilities: { http: true },
        sessionCapabilities: { close: {}, list: {}, resume: {} },
      },
    };
  }

  if (method === "session/new") {
    const state = load();
    const sessionId = `stub-session-${state.sessions.length + 1}`;
    state.sessions.push({ sessionId, cwd: params.cwd, mcpServers: params.mcpServers ?? [] });
    save(state);
    return { sessionId, configOptions: [] };
  }

  if (method === "session/list") {
    return { sessions: load().sessions };
  }

  if (method === "session/resume") {
    const state = load();
    if (!state.sessions.some((s) => s.sessionId === params.sessionId)) {
      throw new Error(`no such session: ${params.sessionId}`);
    }
    return { configOptions: [] };
  }

  if (method === "session/close") return {};

  if (method === "session/prompt") {
    const { sessionId } = params;
    if (toolName) {
      const toolCallId = `call-${toolName}`;
      update(sessionId, { sessionUpdate: "tool_call", toolCallId, title: toolName, status: "pending", rawInput: {} });
      const answer = await ask("session/request_permission", {
        sessionId,
        toolCall: { toolCallId, title: toolName, rawInput: {} },
        options: [
          { optionId: "allow-once", name: "Allow", kind: "allow_once" },
          { optionId: "reject-once", name: "Reject", kind: "reject_once" },
        ],
      });
      const allowed = answer?.outcome?.optionId === "allow-once";
      update(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: allowed ? "completed" : "failed",
      });
      update(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: allowed ? `${toolName} ran` : `${toolName} refused` },
      });
      return { stopReason: "end_turn" };
    }

    update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
    return { stopReason: "end_turn" };
  }

  throw new Error(`unknown method: ${method}`);
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const raw = line.trim();
  if (!raw.startsWith("{")) return;
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  // A response to something we asked the client.
  if (message.id !== undefined && message.method === undefined) {
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message.result);
    }
    return;
  }

  if (message.method === undefined) return;
  void handle(message.method, message.params ?? {}).then(
    (result) => {
      if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result });
    },
    (error) => {
      if (message.id !== undefined) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error.message } });
      }
    },
  );
});
