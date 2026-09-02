import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompiledAgent } from "../../builder/types.js";
import { AcpRuntime, childEnv, type AcpLauncher, type AgentLaunch } from "../acp/adapter.js";
import { buildPreset } from "./preset.js";

/**
 * DshRuntime — the real DeepSeek Harness.
 *
 * DSH speaks ACP, so every line of protocol handling comes from `AcpRuntime`
 * unchanged: sessions, prompts, permission requests, resume. What this target
 * adds is the step before the agent exists.
 *
 * A stock DSH session mounts whatever its deployment composed. Measured, that
 * was forty tools including a shell, all of them reachable regardless of what
 * the manifest said (docs/poc-review-2026-09-02.md §9.4). A Cordis patch is
 * applied at boot, so a tool the manifest does not justify is never mounted —
 * which is the difference between an agent that is asked not to use a shell
 * and an agent that does not have one.
 *
 * What it still cannot do is unchanged from `acp` and reported the same way:
 * `dsh-mcp-client` bridges a server's whole tool set with no way to select a
 * subset, so `policy.forbidden` on an MCP tool remains unenforceable here.
 */

const DEFAULT_PROFILE = "acp";

export class DshRuntime extends AcpRuntime {
  override readonly id = "dsh";

  constructor() {
    super(new DshLauncher());
  }

  override unsupported(compiled: CompiledAgent): string[] {
    const gaps: string[] = [];
    // The Builder's own tools are TypeScript in this repo; a separate process
    // cannot be handed them, and a DSH plugin is not a substitute for one.
    if (compiled.tools.length) gaps.push("tools.local");
    // Withholding DSH's own tools works. Withholding one tool of an MCP
    // server does not, so a manifest that forbids by name is not honoured.
    if (compiled.policy.forbidden.length) gaps.push("policy.forbidden");
    return gaps;
  }
}

/**
 * Writes the patch layer, then names the command that consumes it.
 *
 * The patch is a file rather than a flag because that is DSH's own composition
 * mechanism: the same layer an operator would hand-write, generated from the
 * manifest instead.
 */
class DshLauncher implements AcpLauncher {
  async prepare(compiled: CompiledAgent): Promise<AgentLaunch> {
    const command = process.env.DSH_COMMAND;
    if (!command) {
      throw new Error(
        "dsh: DSH_COMMAND is not set — point it at the harness binary, " +
          "e.g. DSH_COMMAND=./node_modules/.bin/dsh. DSH_HOME must hold a " +
          `'${DEFAULT_PROFILE}' profile; create one with ` +
          `'dsh plugin --profile ${DEFAULT_PROFILE} add @deepseek-ai/dsh-acp-app'.`,
      );
    }

    const preset = buildPreset(compiled);
    const dir = await mkdtemp(join(tmpdir(), "agent-builder-dsh-"));
    const patchPath = join(dir, "agent-builder.cordis.patch.yml");
    await writeFile(patchPath, preset.patch, "utf8");

    const profile = process.env.DSH_PROFILE ?? DEFAULT_PROFILE;
    // DSH_ARGS comes first so the command can be a wrapper — `node ./bin.js`,
    // a shim, the conformance stand-in — and still receive the composition
    // flags in the position the harness expects them.
    const prefix = (process.env.DSH_ARGS ?? "").split(" ").filter(Boolean);
    return {
      command,
      args: [...prefix, "--profile", profile, "--patch", patchPath],
      env: {
        ...childEnv(),
        // Set here rather than left to the operator: the sandbox mode is part
        // of what the manifest's autonomy level means, and an environment
        // that disagreed with the patch would be the harder bug to find.
        DSH_PERMISSION_MODE: preset.permissionMode,
      },
      cleanup: () => rm(dir, { recursive: true, force: true }),
    };
  }
}
