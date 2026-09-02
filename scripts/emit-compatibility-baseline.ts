import { readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";
import { getRuntime, listRuntimeIds } from "../builder/registry/runtimes.js";
import { classifyGaps, refusesRun } from "../builder/registry/capabilities.js";

/**
 * Record what the Builder does today with manifests written yesterday.
 *
 * The contract this baseline protects is behavioural, not structural: a
 * manifest that used to compile and run must keep compiling and running.
 * A TypeScript interface can stay identical while an added validation rule,
 * a stricter policy default or a new blocking `unsupported()` case turns a
 * valid manifest into a rejected one — and that is a breaking change even
 * though no signature moved.
 *
 * Regenerating this file is therefore a deliberate act, not routine
 * maintenance. If the test fails, the question is which of the two happened:
 * a bug to fix, or a contract change that needs an explicit version bump and
 * a note saying why.
 */

const MANIFESTS = resolve(import.meta.dirname, "../tests/compatibility/manifests");
const OUTPUT = resolve(import.meta.dirname, "../tests/compatibility/baseline.json");

export interface CompiledSnapshot {
  /** Locked so an edited fixture fails instead of quietly changing the question. */
  manifestChecksum: string;
  purpose: string;
  model: { requested: string; id: string; route: string; apiKeyEnv: string; baseUrl: string };
  modelFallbacks: string[];
  systemPromptLines: number;
  tools: { name: string; effect: string }[];
  skills: string[];
  mcpServers: { name: string; transport: string }[];
  autonomy: { level: number; allowedEffects: string[] };
  approvalRequired: string[];
  droppedByPolicy: string[];
  policy: { forbidden: string[]; humanApproval: string[] };
  audit: boolean;
  /** Per runtime: what it declares it cannot honour, and whether that refuses the run. */
  runtimes: Record<string, { unsupported: string[]; refusesRun: boolean }>;
}

export type Baseline = Record<string, CompiledSnapshot>;

export async function renderBaseline(): Promise<Baseline> {
  // Pinned so the recorded model route does not depend on the machine that
  // generated the file.
  const savedGateway = process.env.LLM_GATEWAY_BASE_URL;
  delete process.env.LLM_GATEWAY_BASE_URL;

  try {
    const files = (await readdir(MANIFESTS)).filter((f) => f.endsWith(".yaml")).toSorted();
    const runtimes = listRuntimeIds();
    const baseline: Baseline = {};

    for (const file of files) {
      const loaded = await loadManifest(resolve(MANIFESTS, file));
      const result = validateManifest(loaded.value);
      if (!result.ok) {
        throw new Error(`compatibility fixture '${file}' no longer validates: ${result.errors.join("; ")}`);
      }
      const compiled = compileManifest(loaded.value as AgentManifest, loaded.checksum);
      const agent = compiled.agent;

      const perRuntime: CompiledSnapshot["runtimes"] = {};
      for (const id of runtimes) {
        const runtime = await getRuntime(id);
        const gaps = runtime.unsupported(agent);
        perRuntime[id] = { unsupported: gaps.toSorted(), refusesRun: refusesRun(classifyGaps(gaps)) };
      }

      baseline[file] = {
        manifestChecksum: agent.manifestChecksum,
        purpose: agent.purpose,
        model: {
          requested: agent.model.requested,
          id: agent.model.id,
          route: agent.model.route,
          apiKeyEnv: agent.model.apiKeyEnv,
          baseUrl: agent.model.baseUrl,
        },
        modelFallbacks: agent.modelFallbacks.map((m) => m.requested),
        systemPromptLines: agent.systemPrompt.split("\n").length,
        tools: agent.tools.map((t) => ({ name: t.name, effect: t.effect })).toSorted((a, b) => a.name.localeCompare(b.name)),
        skills: agent.skills.map((s) => s.name).toSorted(),
        mcpServers: agent.mcpServers.map((m) => ({ name: m.name, transport: m.transport })).toSorted((a, b) => a.name.localeCompare(b.name)),
        autonomy: { level: agent.autonomy.level, allowedEffects: [...agent.autonomy.allowedEffects] },
        approvalRequired: agent.approvalRequired.toSorted(),
        droppedByPolicy: compiled.droppedByPolicy.toSorted(),
        policy: {
          forbidden: [...agent.policy.forbidden].toSorted(),
          humanApproval: [...agent.policy.humanApproval].toSorted(),
        },
        audit: agent.audit,
        runtimes: perRuntime,
      };
    }
    return baseline;
  } finally {
    if (savedGateway === undefined) delete process.env.LLM_GATEWAY_BASE_URL;
    else process.env.LLM_GATEWAY_BASE_URL = savedGateway;
  }
}

if (process.argv[1]?.endsWith("emit-compatibility-baseline.ts")) {
  const baseline = await renderBaseline();
  await writeFile(OUTPUT, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${OUTPUT} (${Object.keys(baseline).length} manifests)\n`);
}
