import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { parse } from "yaml";
import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";
import { buildPreset } from "../runtimes/dsh/preset.js";
import type { CompiledAgent } from "../builder/types.js";

/**
 * The patch is the whole of what `dsh` adds over `acp`, so it is the part
 * worth testing hard. Everything below it is AcpRuntime, which the ACP suite
 * already covers against a live peer.
 */

async function compiled(name: string, dir = "../manifests"): Promise<CompiledAgent> {
  const loaded = await loadManifest(resolve(import.meta.dirname, dir, name));
  const result = validateManifest(loaded.value);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return compileManifest(loaded.value as AgentManifest, loaded.checksum).agent;
}

function rowsOf(patch: string): { id: string; disabled?: boolean; config?: Record<string, unknown> }[] {
  return parse(patch) as { id: string; disabled?: boolean; config?: Record<string, unknown> }[];
}

function withAutonomy(agent: CompiledAgent, level: number, effects: CompiledAgent["autonomy"]["allowedEffects"]) {
  return { ...agent, autonomy: { level, allowedEffects: effects } };
}

describe("dsh preset", () => {
  it("withholds the shell unless the manifest allows irreversible effects", async () => {
    const agent = await compiled("researcher.yaml");

    for (const level of [0, 1, 2]) {
      const effects = level === 0 ? [] : level === 1 ? (["read"] as const) : (["read", "write"] as const);
      const preset = buildPreset(withAutonomy(agent, level, [...effects]));
      expect(preset.withheld, `level ${level}`).toContain("tool-bash");
      expect(preset.withheld, `level ${level}`).toContain("tool-pwsh");
    }

    const acting = buildPreset(withAutonomy(agent, 3, ["read", "write", "irreversible"]));
    expect(acting.withheld).not.toContain("tool-bash");
  });

  it("always withholds tools that start other agents", async () => {
    // Sub-agents are not expressible in the manifest yet, and an agent that
    // can spawn one escapes whatever tool set this patch just chose.
    const preset = buildPreset(await compiled("researcher.yaml"));
    for (const id of [
      "tool-subagent",
      "tool-subagent-control",
      "tool-ralph",
      "tool-workflow",
      // Both of these survived the first version of this list, because the
      // base bundle mounts one package under several row ids and a patch
      // disables rows, not packages. A run against the real harness caught it.
      "tool-subagent-fork",
      "tool-subagent-list-agents",
    ]) {
      expect(preset.withheld).toContain(id);
    }
  });

  it("withholds web access only when the agent may not even read", async () => {
    const agent = await compiled("researcher.yaml");
    expect(buildPreset(withAutonomy(agent, 0, [])).withheld).toContain("tool-web");
    expect(buildPreset(withAutonomy(agent, 1, ["read"])).withheld).not.toContain("tool-web");
  });

  it("maps autonomy onto the sandbox mode the harness enforces", async () => {
    const agent = await compiled("researcher.yaml");
    expect(buildPreset(withAutonomy(agent, 0, [])).permissionMode).toBe("read-only");
    expect(buildPreset(withAutonomy(agent, 1, ["read"])).permissionMode).toBe("read-only");
    expect(buildPreset(withAutonomy(agent, 2, ["read", "write"])).permissionMode).toBe("workspace-write");
    expect(
      buildPreset(withAutonomy(agent, 3, ["read", "write", "irreversible"])).permissionMode,
    ).toBe("danger-full-access");
  });

  it("keeps file tools mounted and lets the sandbox gate them", async () => {
    // Measured: the sandbox refuses a write under read-only and fails closed,
    // so removing `tool-fs` would cost the agent reading for no added safety.
    const preset = buildPreset(withAutonomy(await compiled("researcher.yaml"), 1, ["read"]));
    expect(preset.withheld).not.toContain("tool-fs");
    expect(preset.withheld).not.toContain("tool-fs-search");
  });

  it("routes the model through the binding the Builder resolved", async () => {
    const agent = await compiled("researcher.yaml");
    const rows = rowsOf(buildPreset(agent).patch);

    const llm = rows.find((r) => r.id === "llm-pi-ai");
    const provider = (llm?.config?.providers as Record<string, Record<string, unknown>>)["agent-builder"];
    expect(provider?.baseURL).toBe(agent.model.baseUrl);
    expect(provider?.apiKeyEnv).toBe(agent.model.apiKeyEnv);
    expect(provider?.api).toBe("openai-completions");

    const acp = rows.find((r) => r.id === "acp");
    expect(acp?.config).toEqual({ provider: "agent-builder", model: agent.model.id });
  });

  it("hands the manifest's prompt to the harness without claiming the whole prompt", async () => {
    const agent = await compiled("researcher.yaml");
    const rows = rowsOf(buildPreset(agent).patch);
    const prompt = rows.find((r) => r.id === "system-prompt");
    expect(prompt?.config?.persona).toBe(agent.systemPrompt);
    // `complete` stays unset: the runtime still explains its own tools, which
    // is knowledge the manifest does not have.
    expect(prompt?.config).not.toHaveProperty("complete");
  });

  it("is reproducible and names the manifest it came from", async () => {
    const agent = await compiled("researcher.yaml");
    const first = buildPreset(agent);
    expect(buildPreset(agent).patch).toBe(first.patch);
    expect(first.patch).toContain(agent.manifestChecksum);
    expect(first.patch).toContain("do not edit");
  });
});
