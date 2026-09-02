import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest, type CompileResult } from "../builder/compiler.js";
import { openAuditLog } from "../builder/audit.js";
import { RunAborted, executedTools } from "../builder/errors.js";
import { packageAgent, writePackage } from "../builder/packager.js";
import { getRuntime, listRuntimeIds } from "../builder/registry/runtimes.js";
import {
  catalogEntry,
  catalogOrigin,
  listModelNames,
  listRemoteModels,
  loadCatalog,
} from "../builder/registry/models.js";
import { AUTONOMY_LEVELS } from "../builder/registry/policy.js";
import type { ApprovalDecision, ApprovalRequest, TraceEvent } from "../builder/types.js";

const USAGE = `agent-builder — build agents from an Agent Manifest, run them on any target

Usage:
  agent-builder validate <manifest>
  agent-builder inspect  <manifest> [--target <id>]
  agent-builder build    <manifest> --target <id> [--out <file>]
  agent-builder run      <manifest> --target <id> [--input "..."] [--approve <mode>]
  agent-builder targets
  agent-builder models [--provider <name>]

Options:
  --target <id>     Build target. Known: ${listRuntimeIds().join(", ")}
  --input "<text>"  Prompt to send (run)
  --out <file>      Where to write the package (build)
  --approve <mode>  auto | deny | prompt   (default: prompt on a TTY, else deny)
  --trace           Print audit trace events as they happen
  --audit-log <f>   Append the run and its trace to <f> as JSON Lines
  --provider <name> Which catalog entry to query for live model ids (models)

A runtime is a build target, not part of the agent: the same manifest builds
for every target, and 'agent-builder build' proves it by emitting the same
manifest checksum each time.
`;

interface Args {
  command: string;
  manifest?: string;
  flags: Map<string, string | true>;
}

/**
 * Parse `cmd <positional> --flag value --bool`. Flag VALUES are never
 * mistaken for the positional argument — the predecessor CLI used
 * `args.find(a => !a.startsWith("--"))` and happily opened "mock" as a file.
 */
function parseArgs(argv: string[]): Args {
  const [command = "", ...rest] = argv;
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] as string;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }
  return { command, manifest: positionals[0], flags };
}

function flagString(args: Args, key: string): string | undefined {
  const value = args.flags.get(key);
  return typeof value === "string" ? value : undefined;
}

const out = (s: string) => process.stdout.write(s);
const err = (s: string) => process.stderr.write(s);

async function loadAndCompile(path: string, target: string): Promise<CompileResult> {
  const loaded = await loadManifest(resolve(path));
  const result = validateManifest(loaded.value);

  for (const e of result.errors) out(`  ✗ ${e}\n`);
  for (const w of result.warnings) out(`  ⚠ ${w}\n`);
  if (!result.ok) throw new Error("manifest is invalid");
  out(`  ✓ manifest is valid (${loaded.checksum.slice(0, 12)}…)\n`);

  const compiled = compileManifest(loaded.value as AgentManifest, loaded.checksum);

  if (compiled.droppedByPolicy.length) {
    out(`  ⛔ withheld by policy.forbidden: ${compiled.droppedByPolicy.join(", ")}\n`);
  }
  if (compiled.bypassesGateway) {
    out(
      `  ⚠ B1: LLM_GATEWAY_BASE_URL is not set — calling ${compiled.agent.model.baseUrl} directly.\n` +
        `      Set it so LLM traffic goes through llm-gateway.\n`,
    );
  }

  const runtime = await getRuntime(target);
  const gaps = runtime.unsupported(compiled.agent);
  if (gaps.length) out(`  ⚠ target '${target}' does not support: ${gaps.join(", ")}\n`);

  return compiled;
}

function approver(mode: string): (req: ApprovalRequest) => Promise<ApprovalDecision> {
  if (mode === "auto") {
    return async (req) => {
      out(`  ↪ auto-approved ${req.tool} (${req.effect})\n`);
      return "allow";
    };
  }
  if (mode === "deny") {
    return async (req) => {
      out(`  ↪ auto-denied ${req.tool} (${req.effect}) — ${req.reason}\n`);
      return "deny";
    };
  }
  return async (req) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(
        `\n  ⚠ ${req.tool} (${req.effect}) needs approval — ${req.reason}\n` +
          `    args: ${JSON.stringify(req.args)}\n` +
          `    allow? [y/N] `,
      );
      return answer.trim().toLowerCase().startsWith("y") ? "allow" : "deny";
    } finally {
      rl.close();
    }
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.command === "help" || args.flags.has("help")) {
    out(USAGE);
    return 0;
  }

  if (args.command === "targets") {
    out(`\nBuild targets:\n`);
    for (const id of listRuntimeIds()) out(`  ${id}\n`);
    out(`\nAutonomy levels:\n`);
    for (const l of AUTONOMY_LEVELS) {
      out(`  ${l.level}  ${l.name.padEnd(8)} ${l.summary}\n`);
      out(`     ${" ".repeat(9)}effects allowed without approval: ${l.allowedEffects.join(", ") || "none"}\n`);
    }
    out(`\nModel catalog source: ${catalogOrigin()}\n\n`);
    return 0;
  }

  if (args.command === "models") {
    await loadCatalog().catch(() => {});
    out(`\nCatalog (${catalogOrigin()})\n`);
    for (const name of listModelNames()) {
      const entry = catalogEntry(name);
      out(`  ${name.padEnd(20)} ${entry?.id || "(no model id — set its env var)"}\n`);
    }

    // If we can reach a provider, report what it actually serves rather than
    // guessing. The gateway wins when configured, same as at compile time.
    const provider = flagString(args, "provider");
    const gateway = process.env.LLM_GATEWAY_BASE_URL?.replace(/\/+$/, "");
    const baseUrl = gateway ?? (provider ? catalogEntry(provider)?.directBaseUrl : undefined);
    const keyEnv = gateway ? "LLM_GATEWAY_API_KEY" : provider ? catalogEntry(provider)?.apiKeyEnv : undefined;
    const key = keyEnv ? process.env[keyEnv] : undefined;

    if (!baseUrl) {
      out(`\nTo list what an endpoint actually serves: set LLM_GATEWAY_BASE_URL, or pass --provider <name>.\n\n`);
      return 0;
    }
    if (!key) {
      out(`\n${baseUrl} — cannot query: ${keyEnv} is not set\n\n`);
      return 0;
    }
    try {
      const models = await listRemoteModels(baseUrl, key);
      out(`\nServed by ${baseUrl}\n`);
      for (const m of models) out(`  ${m.id}\n`);
      out(`\n`);
    } catch (e) {
      err(`\ncould not query ${baseUrl}: ${(e as Error).message}\n\n`);
      return 1;
    }
    return 0;
  }

  if (!args.manifest) {
    err(`error: missing <manifest>\n\n${USAGE}`);
    return 2;
  }

  await loadCatalog().catch((e: Error) => {
    err(`  ⚠ free-llm-registry unreachable (${e.message}) — using the built-in seed catalog\n`);
  });

  if (args.command === "validate") {
    const loaded = await loadManifest(resolve(args.manifest));
    const result = validateManifest(loaded.value);
    for (const e of result.errors) out(`  ✗ ${e}\n`);
    for (const w of result.warnings) out(`  ⚠ ${w}\n`);
    out(result.ok ? `  ✓ manifest is valid\n` : `  ✗ manifest is INVALID\n`);
    return result.ok ? 0 : 1;
  }

  const target = flagString(args, "target");
  if (!target && args.command !== "inspect") {
    err(`error: --target is required for '${args.command}' (known: ${listRuntimeIds().join(", ")})\n`);
    return 2;
  }
  const effectiveTarget = target ?? "mock";

  let compiled: CompileResult;
  try {
    compiled = await loadAndCompile(args.manifest, effectiveTarget);
  } catch (e) {
    err(`\n${(e as Error).message}\n`);
    return 1;
  }
  const agent = compiled.agent;

  if (args.command === "inspect") {
    out(`\nAgent      ${agent.name}@${agent.version}`);
    out(`\nPurpose    ${agent.purpose}`);
    out(`\nTarget     ${effectiveTarget}`);
    out(`\nModel      ${agent.model.requested} → ${agent.model.id}  [${agent.model.route}] ${agent.model.baseUrl}`);
    out(`\nAutonomy   level ${agent.autonomy.level} — may self-invoke: ${agent.autonomy.allowedEffects.join(", ") || "nothing"}`);
    out(`\nChecksum   ${agent.manifestChecksum}\n`);
    out(`\nTools granted\n`);
    for (const t of agent.tools) {
      const gate = agent.approvalRequired.includes(t.name) ? "  ⚠ needs approval" : "";
      out(`  ✓ ${t.name}  [${t.effect}]${gate}\n`);
    }
    if (!agent.tools.length) out(`  (none)\n`);
    if (compiled.droppedByPolicy.length) {
      out(`\nWithheld\n`);
      for (const n of compiled.droppedByPolicy) out(`  ⛔ ${n}\n`);
    }
    out(`\nSkills\n`);
    for (const s of agent.skills) out(`  ✓ ${s.name} — ${s.description}\n`);
    if (!agent.skills.length) out(`  (none)\n`);
    out(`\nMCP\n`);
    for (const m of agent.mcpServers) out(`  ✓ ${m.name} (${m.transport})\n`);
    if (!agent.mcpServers.length) out(`  (none)\n`);
    out(`\nAudit      ${agent.audit ? "on" : "off"}\n\n`);
    return 0;
  }

  if (args.command === "build") {
    const pkg = packageAgent(agent, effectiveTarget);
    const outPath = flagString(args, "out");
    if (outPath) {
      await writePackage(pkg, resolve(outPath));
      out(`\nwrote ${outPath}\n`);
    } else {
      out(`\n${JSON.stringify(pkg, null, 2)}\n`);
    }
    return 0;
  }

  if (args.command === "run") {
    const mode = flagString(args, "approve") ?? (process.stdin.isTTY ? "prompt" : "deny");
    const showTrace = args.flags.has("trace");
    const input =
      flagString(args, "input") ?? "Introduce yourself and name one thing you can do with your tools.";

    const auditPath = flagString(args, "audit-log");
    const audit = auditPath
      ? await openAuditLog(resolve(auditPath), { agent, target: effectiveTarget, input })
      : undefined;
    if (audit) out(`  · run ${audit.runId} → ${auditPath}\n`);
    // The manifest asked to be audited; saying so beats keeping the trail in
    // this process and losing it on exit.
    if (agent.audit && !audit) {
      err(`  ⚠ manifest requires audit but nothing is storing it — pass --audit-log <file>\n`);
    }

    const runtime = await getRuntime(effectiveTarget);
    const handle = await runtime.createAgent(agent);
    try {
      const result = await runtime.run(handle, input, {
        requestApproval: approver(mode),
        onTrace: (e: TraceEvent) => {
          audit?.record(e);
          if (showTrace) out(`  · ${e.kind} ${JSON.stringify(e.detail)}\n`);
        },
      });
      out(`\n--- output ---\n${result.output}\n`);
      out(`\n(target: ${effectiveTarget} · tool calls: ${result.toolCalls} · trace: ${result.trace.length} events)\n`);
      return 0;
    } catch (e) {
      err(`\nrun failed: ${(e as Error).message}\n`);
      // A failure after a tool ran is the dangerous case: the side effect is
      // real whatever the exit code says.
      if (e instanceof RunAborted) {
        const landed = executedTools(e.result);
        if (landed.length) {
          err(`\n⚠ ${landed.length} tool call(s) completed before the failure — their effects are live:\n`);
          for (const name of landed) err(`    ✓ ${name}\n`);
        }
      }
      return 1;
    } finally {
      await handle.dispose().catch(() => {});
      await audit?.close().catch((error: Error) => err(`  ⚠ ${error.message}\n`));
    }
  }

  err(`error: unknown command '${args.command}'\n\n${USAGE}`);
  return 2;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    err(`fatal: ${(e as Error).stack ?? e}\n`);
    process.exit(1);
  },
);
