// Minimal ACP client: drive DeepSeek Harness over newline-delimited JSON-RPC on stdio.
// Goal of the spike: (1) does ACP carry MCP + permissions + resume?
//                    (2) which tools does the agent actually get?  <- the capability-leak question
import { spawn } from "node:child_process";
import readline from "node:readline";

const [, , ...cmd] = process.argv;
if (!cmd.length) { console.error("usage: node acp-spike.mjs <dsh-bin> [args...]"); process.exit(2); }

const ZEN_KEY = process.env.OPENCODE_ZEN_API_KEY;
const MCP_URL = process.env.AI_COLLAB_MCP_URL;
const MCP_TOKEN = process.env.AI_COLLAB_MCP_TOKEN;

const child = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", (b) => process.stderr.write("[dsh] " + b));
child.on("exit", (c, s) => console.log(`\n[dsh exited code=${c} signal=${s}]`));

let nextId = 1;
const pending = new Map();
const toolsSeen = new Set();
const permissionsAsked = [];
const updateKinds = new Map();

function send(obj) { child.stdin.write(JSON.stringify(obj) + "\n"); }
function call(method, params) {
  const id = nextId++;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); send({ jsonrpc: "2.0", id, method, params }); });
}

readline.createInterface({ input: child.stdout }).on("line", (line) => {
  line = line.trim(); if (!line.startsWith("{")) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }

  if (msg.id !== undefined && msg.method === undefined) {          // response to us
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (!p) return;
    if (msg.error) p.rej(new Error(`${msg.error.code}: ${msg.error.message}${msg.error.data ? " " + JSON.stringify(msg.error.data) : ""}`));
    else p.res(msg.result);
    return;
  }

  if (msg.method === "session/update") {                            // notification
    const u = msg.params?.update ?? {};
    const kind = u.sessionUpdate ?? "?";
    updateKinds.set(kind, (updateKinds.get(kind) ?? 0) + 1);
    if (kind === "tool_call") {
      const name = u.title ?? u.rawInput?.name ?? u.kind ?? "?";
      toolsSeen.add(`${name}`);
      console.log(`  · tool_call   ${name}  [${u.kind ?? "-"}] ${JSON.stringify(u.rawInput ?? {}).slice(0, 140)}`);
    } else if (kind === "agent_message_chunk") {
      process.stdout.write(u.content?.text ?? "");
    } else if (kind !== "agent_thought_chunk") {
      console.log(`  · ${kind} ${JSON.stringify(u).slice(0, 160)}`);
    }
    return;
  }

  if (msg.method === "session/request_permission") {                // agent asks US
    const opts = msg.params?.options ?? [];
    permissionsAsked.push({ tool: msg.params?.toolCall?.title ?? msg.params?.toolCall?.rawInput?.name, options: opts.map(o => o.optionId + ":" + o.kind) });
    const allow = opts.find((o) => String(o.kind).startsWith("allow")) ?? opts[0];
    console.log(`  ⚑ request_permission -> ${msg.params?.toolCall?.title} | options=${opts.map(o => o.kind).join(",")} | answering ${allow?.kind}`);
    send({ jsonrpc: "2.0", id: msg.id, result: { outcome: { outcome: "selected", optionId: allow.optionId } } });
    return;
  }

  if (msg.method) {                                                 // any other agent->client call
    console.log(`  ← agent called ${msg.method} ${JSON.stringify(msg.params ?? {}).slice(0, 120)}`);
    if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not implemented by spike client" } });
  }
});

const t = (label, p) => p.then(r => { console.log(`✓ ${label}`); return r; }, e => { console.log(`✗ ${label}: ${e.message}`); throw e; });

try {
  const init = await t("initialize", call("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  }));
  console.log("   agentCapabilities:", JSON.stringify(init.agentCapabilities ?? init));

  const mcpServers = MCP_URL && MCP_TOKEN ? [{
    type: "http", name: "collaboration", url: MCP_URL,
    headers: [{ name: "Authorization", value: `Bearer ${MCP_TOKEN}` }],
  }] : [];

  const sess = await t("session/new (+MCP)", call("session/new", { cwd: process.cwd(), mcpServers }));
  const sessionId = sess.sessionId;
  console.log("   sessionId:", sessionId);
  console.log("   configOptions:", JSON.stringify(sess.configOptions ?? sess.modes ?? {}).slice(0, 600));

  const prompt = process.env.SPIKE_PROMPT ?? "List every tool you have available, exactly by name, one per line. Then call the workspace context tool and summarise what is pending. Do not do anything else.";
  console.log("\n--- prompt ---");
  const res = await t("session/prompt", call("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] }));
  console.log("\n   stopReason:", res.stopReason);

  // resume path — the thing both POCs still throw on
  try {
    const listed = await call("session/list", {});
    console.log(`✓ session/list -> ${(listed.sessions ?? []).length} resumable`);
  } catch (e) { console.log("✗ session/list:", e.message); }

  console.log("\n===== SPIKE SUMMARY =====");
  console.log("tools observed:", [...toolsSeen].join(", ") || "(none)");
  console.log("permission prompts:", permissionsAsked.length, JSON.stringify(permissionsAsked).slice(0, 400));
  console.log("update kinds:", JSON.stringify(Object.fromEntries(updateKinds)));
} catch (e) {
  console.log("\nSPIKE FAILED:", e.message);
} finally {
  child.stdin.end(); setTimeout(() => child.kill("SIGKILL"), 1500);
}
