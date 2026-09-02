import type { AgentManifest } from "./validator.js";
import type { CompiledAgent } from "./types.js";
import { resolveCapabilities } from "./resolver.js";
import { resolveModel } from "./registry/models.js";
import { autonomyFor, decideCapabilities } from "./registry/policy.js";

/**
 * Compiler: AgentManifest -> CompiledAgent.
 *
 * The output is runtime-neutral by construction: no vendor type appears in
 * it, and the same CompiledAgent is what every adapter receives. The build
 * target is NOT an input here — it only decides which adapter consumes the
 * result, which is exactly why swapping targets cannot alter the agent.
 */
export interface CompileResult {
  agent: CompiledAgent;
  /** Tools the manifest asked for that policy removed. */
  droppedByPolicy: string[];
  /** True when the model resolved straight to a provider, bypassing llm-gateway (B1). */
  bypassesGateway: boolean;
}

export function compileManifest(manifest: AgentManifest, manifestChecksum: string): CompileResult {
  const { tools, skills, mcpServers } = resolveCapabilities({
    tools: manifest.spec.tools?.allowed,
    skills: manifest.spec.skills,
    mcp: manifest.spec.mcp?.servers,
  });

  const autonomy = autonomyFor(manifest.spec.autonomy.level);
  const decision = decideCapabilities({
    allowed: tools,
    forbidden: manifest.spec.policy?.forbidden ?? [],
    autonomy,
    humanApproval: manifest.spec.humanApproval?.required ?? [],
  });

  const model = resolveModel(manifest.spec.model.preferred);

  return {
    agent: {
      name: manifest.metadata.name,
      version: manifest.metadata.version,
      description: manifest.metadata.description ?? "",
      purpose: manifest.spec.purpose.primary,
      model,
      systemPrompt: composeSystemPrompt(manifest, skills, decision.approvalRequired),
      tools: decision.granted,
      skills,
      mcpServers,
      autonomy,
      approvalRequired: decision.approvalRequired,
      audit: manifest.spec.audit?.required ?? false,
      manifestChecksum,
    },
    droppedByPolicy: decision.forbidden,
    bypassesGateway: model.route === "direct",
  };
}

/**
 * The system prompt is assembled, not copied. `purpose` names the job,
 * skills supply the behaviour, and the policy section tells the model the
 * truth about its own limits — a model that knows a tool is gated asks for
 * it properly instead of looping on a refusal it cannot see.
 */
function composeSystemPrompt(
  manifest: AgentManifest,
  skills: { instructions: string }[],
  approvalRequired: string[],
): string {
  const blocks: string[] = [];

  blocks.push(`You are "${manifest.metadata.name}". Your primary purpose is: ${manifest.spec.purpose.primary}.`);

  if (manifest.spec.system?.instructions) blocks.push(manifest.spec.system.instructions.trim());
  for (const skill of skills) blocks.push(skill.instructions);

  const forbidden = manifest.spec.policy?.forbidden ?? [];
  const policyLines: string[] = [];
  if (forbidden.length) {
    policyLines.push(
      `- These capabilities are withheld from you and cannot be called: ${forbidden.join(", ")}. Do not describe workarounds for them.`,
    );
  }
  if (approvalRequired.length) {
    policyLines.push(
      `- These require a human to approve each call: ${approvalRequired.join(", ")}. Explain why before you call one.`,
    );
  }
  if (policyLines.length) blocks.push(["## Operating limits", ...policyLines].join("\n"));

  return blocks.join("\n\n");
}
