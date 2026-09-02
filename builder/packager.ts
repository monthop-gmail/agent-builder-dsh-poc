import { writeFile } from "node:fs/promises";
import type { CompiledAgent } from "./types.js";

/**
 * Packager: CompiledAgent + target -> a portable, inspectable artifact.
 *
 * `manifestChecksum` is carried through untouched. Two packages built from
 * one manifest for different targets must agree on it and on `capabilities`
 * — that equality IS the portability guarantee, and the test asserts it.
 */
export interface AgentPackage {
  formatVersion: 1;
  target: string;
  builtAt: string;
  manifestChecksum: string;
  agent: {
    name: string;
    version: string;
    description: string;
    purpose: string;
  };
  model: CompiledAgent["model"];
  systemPrompt: string;
  capabilities: {
    tools: { name: string; effect: string }[];
    skills: string[];
    mcpServers: { name: string; transport: string }[];
  };
  governance: {
    autonomy: CompiledAgent["autonomy"];
    approvalRequired: string[];
    audit: boolean;
  };
}

export function packageAgent(compiled: CompiledAgent, target: string): AgentPackage {
  return {
    formatVersion: 1,
    target,
    builtAt: new Date().toISOString(),
    manifestChecksum: compiled.manifestChecksum,
    agent: {
      name: compiled.name,
      version: compiled.version,
      description: compiled.description,
      purpose: compiled.purpose,
    },
    model: compiled.model,
    systemPrompt: compiled.systemPrompt,
    capabilities: {
      tools: compiled.tools.map((t) => ({ name: t.name, effect: t.effect })),
      skills: compiled.skills.map((s) => s.name),
      mcpServers: compiled.mcpServers.map((m) => ({ name: m.name, transport: m.transport })),
    },
    governance: {
      autonomy: compiled.autonomy,
      approvalRequired: compiled.approvalRequired,
      audit: compiled.audit,
    },
  };
}

export async function writePackage(pkg: AgentPackage, outPath: string): Promise<void> {
  await writeFile(outPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}
