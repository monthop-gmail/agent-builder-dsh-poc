import type { AgentManifest } from "./validator.js";
import type { CompiledAgent, ModelBinding } from "./types.js";
import { resolveCapabilities } from "./resolver.js";
import { resolveModelChain } from "./registry/models.js";
import { computeBuildIdentity } from "./identity.js";
import { autonomyFor, decideCapabilities } from "./registry/policy.js";
import {
  assertBindingValid,
  combinePolicies,
  type AgentPolicyView,
  type PlatformPolicy,
} from "./platform.js";

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
  /**
   * Tools the manifest asked for that the platform profile never allowed.
   *
   * Reported apart from `droppedByPolicy` because the two answer different
   * questions: one says "this agent refused it", the other says "this agent
   * was never entitled to it". Folding them together would hide which party
   * made the call, which is the whole subject of ADR-0022.
   */
  droppedByCeiling: string[];
  /**
   * Tools withheld because a capability they need is denied (ADR-0026 rule 2).
   *
   * The portable half of the ceiling: unlike `droppedByCeiling`, which needs
   * both sides to agree on tool names, this works on any registry.
   */
  droppedByCapability: { tool: string; capability: string }[];
  /** True when the model resolved straight to a provider, bypassing llm-gateway (B1). */
  bypassesGateway: boolean;
}

export interface CompileOptions {
  /**
   * The platform ceiling, when the caller supplied one (`--profile`).
   *
   * Optional on purpose: a build with no profile behaves exactly as it did
   * before this existed. The three-party rule cannot be enforced against a
   * party that was never handed over, and pretending otherwise — defaulting
   * to some built-in profile — would be this repo inventing platform policy,
   * which is the one thing every issue we opened was about not doing.
   */
  platform?: PlatformPolicy;
}

export function compileManifest(
  manifest: AgentManifest,
  manifestChecksum: string,
  options: CompileOptions = {},
): CompileResult {
  const agentPolicy: AgentPolicyView = {
    denyTools: manifest.spec.policy?.forbidden ?? [],
    denyCapabilities: manifest.spec.policy?.deniedCapabilities ?? [],
    requireHumanFor: manifest.spec.humanApproval?.required ?? [],
    toolsRequested: manifest.spec.tools?.allowed,
    requiredCapabilities: manifest.spec.capabilities?.required ?? [],
  };

  const effective = combinePolicies(agentPolicy, options.platform);
  assertBindingValid(agentPolicy, effective, options.platform);

  const { tools, skills, mcpServers } = resolveCapabilities({
    tools: effective.toolsAllow,
    skills: manifest.spec.skills,
    mcp: manifest.spec.mcp?.servers,
  });

  const autonomy = autonomyFor(manifest.spec.autonomy.level);
  const decision = decideCapabilities({
    allowed: tools,
    forbidden: effective.denyTools,
    autonomy,
    humanApproval: effective.requireHumanFor,
    deniedCapabilities: effective.denyCapabilities,
  });

  // The capability requirement reaches the Model Registry here — this is the
  // line that makes `spec.capabilities` mean something to model selection
  // rather than only to policy.
  const [model, ...modelFallbacks] = resolveModelChain(
    manifest.spec.model.preferred,
    manifest.spec.capabilities,
  ) as [ModelBinding, ...ModelBinding[]];

  const policy = {
    forbidden: effective.denyTools,
    humanApproval: effective.requireHumanFor,
    deniedCapabilities: effective.denyCapabilities,
  };
  const policySource = effective.profile
    ? { profileId: effective.profile.id, profileChecksum: effective.profile.checksum }
    : undefined;

  return {
    agent: {
      name: manifest.metadata.name,
      version: manifest.metadata.version,
      description: manifest.metadata.description ?? "",
      purpose: manifest.spec.purpose.primary,
      model,
      modelFallbacks,
      systemPrompt: composeSystemPrompt(manifest, skills, decision.approvalRequired, effective.denyTools),
      tools: decision.granted,
      skills,
      mcpServers,
      autonomy,
      approvalRequired: decision.approvalRequired,
      // The EFFECTIVE policy, not the manifest's half of it. Tools that only
      // appear once an MCP server is connected are filtered against this
      // later (`admitLateTools`), so carrying the agent's own list here would
      // let a ceiling-denied tool in through the one door compile time cannot
      // see.
      policy,
      ...(policySource ? { policySource } : {}),
      audit: manifest.spec.audit?.required ?? false,
      manifestChecksum,
      buildIdentity: computeBuildIdentity({
        manifestChecksum,
        chain: [model, ...modelFallbacks],
        policy,
        policySource,
      }),
    },
    droppedByPolicy: decision.forbidden,
    droppedByCeiling: effective.droppedByCeiling,
    droppedByCapability: decision.deniedByCapability,
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
  forbidden: string[],
): string {
  const blocks: string[] = [];

  blocks.push(`You are "${manifest.metadata.name}". Your primary purpose is: ${manifest.spec.purpose.primary}.`);

  if (manifest.spec.system?.instructions) blocks.push(manifest.spec.system.instructions.trim());
  for (const skill of skills) blocks.push(skill.instructions);

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
