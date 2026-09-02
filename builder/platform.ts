import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * The three-party rule, made real.
 *
 * `agent-platform` states in `contracts/profile/v1/profile.schema.yaml`:
 *
 *   > profile เป็น "เพดาน" ไม่ใช่ "การอนุญาต" — สิทธิ์จริงคือส่วนที่ profile,
 *   > agent และ policy ของ tenant ตกลงตรงกันทั้งสามฝ่าย ค่าที่กว้างที่สุดชนะไม่ได้
 *
 * ADR-0022 then wrote down how the parties combine, and said plainly that
 * neither JSON Schema nor their drift check can enforce it:
 *
 *   > กฎการรวม (intersection/union) และกฎ required ∩ deny = ∅ พิสูจน์ได้จาก
 *   > เทสของ consumer ที่รันจริงเท่านั้น
 *
 * This file is that proof, and `tests/platform-policy.test.ts` is where it is
 * actually made. The rules implemented here:
 *
 *   allow  →  intersection   profile.tools.allow ∩ agent.tools.allowed
 *   deny   →  union          deny of ANY party wins, always
 *   required ∩ deny = ∅      otherwise the binding is INVALID — reject it,
 *                            do not quietly hand back a smaller agent
 *
 * The last rule is the one worth stating out loud: an agent that needs
 * `shell` under a profile that denies `shell` is not an agent that runs with
 * less. It is an agent that does not run.
 */

/* ---------- what we accept from the platform ---------- */

/**
 * A `profile/v1` instance, reduced to the parts that bear on permission.
 *
 * `authority_map` is deliberately NOT read. It maps `action_risk` to
 * `authority` and belongs to the tenant (ADR-0010); an agent build is not the
 * place where that mapping gets applied, and reading it here would invite
 * someone to let a manifest override it later.
 */
const profileSchema = z.object({
  profile_id: z.string().min(1),
  extends: z.string().min(1).optional(),
  capability_requirement: z
    .object({
      required: z.array(z.string()).optional(),
      preferred: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
  tools: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
  policy: z
    .object({
      deny_capabilities: z.array(z.string()).optional(),
      require_human_for: z.array(z.string()).optional(),
    })
    .passthrough(),
});

/** The ceiling, as this Builder uses it. */
export interface PlatformPolicy {
  profileId: string;
  /**
   * Allowlist. `undefined` means the profile states none — which is NOT the
   * same as "allow everything". `profiles/README.md`: *"`tools.allow` ว่าง =
   * ไม่อนุญาต tool ใดเลย"* — an empty array denies everything, so the two
   * cases must stay distinguishable.
   */
  toolsAllow?: string[];
  toolsDeny: string[];
  denyCapabilities: string[];
  requireHumanFor: string[];
  requiredCapabilities: string[];
  /**
   * sha256 of the profile bytes.
   *
   * Folded into `CompiledAgent.buildIdentity` — ADR-0022 warned that a
   * deny-list compiled into a build artifact has to live inside that
   * artifact's identity, and ADR-0025 settled how. It is deliberately NOT in
   * `manifestChecksum`, which answers a different question: which source this
   * came from, not which agent it is.
   */
  checksum: string;
  source: string;
}

export async function loadPlatformProfile(path: string): Promise<PlatformPolicy> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read profile '${path}': ${(error as Error).message}`);
  }

  const parsed = profileSchema.safeParse(parseYaml(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`profile '${path}' is not a usable profile/v1 instance — ${issues}`);
  }

  const p = parsed.data;
  return {
    profileId: p.profile_id,
    toolsAllow: p.tools?.allow,
    toolsDeny: p.tools?.deny ?? [],
    denyCapabilities: p.policy.deny_capabilities ?? [],
    requireHumanFor: p.policy.require_human_for ?? [],
    requiredCapabilities: p.capability_requirement?.required ?? [],
    checksum: createHash("sha256").update(raw, "utf8").digest("hex"),
    source: path,
  };
}

/* ---------- what the agent side declares ---------- */

/**
 * Our manifest expressed in `agent/v1.policy` vocabulary.
 *
 * The manifest keeps its own field names — it is a frozen contract and
 * renaming them would break every existing file for no gain. This is the
 * projection, and it exists so the union in `combine` is done in ONE
 * vocabulary rather than translating at three different call sites.
 *
 *   spec.policy.forbidden            →  deny_tools
 *   spec.policy.deniedCapabilities   →  deny_capabilities
 *   spec.humanApproval.required      →  require_human_for
 */
export interface AgentPolicyView {
  denyTools: string[];
  denyCapabilities: string[];
  requireHumanFor: string[];
  /** Tools the manifest asked for. `undefined` when it asked for none. */
  toolsRequested?: string[];
  requiredCapabilities: string[];
}

/**
 * The mapping table, as data.
 *
 * `docs/effective-policy.md` prints this table, and a test compares the two.
 * A mapping that only exists in prose is a mapping that drifts.
 */
export const AGENT_POLICY_FIELD_MAP: ReadonlyArray<{ ours: string; theirs: string }> = [
  { ours: "spec.policy.forbidden", theirs: "policy.deny_tools" },
  { ours: "spec.policy.deniedCapabilities", theirs: "policy.deny_capabilities" },
  { ours: "spec.humanApproval.required", theirs: "policy.require_human_for" },
  { ours: "spec.tools.allowed", theirs: "tools" },
];

/* ---------- the combination ---------- */

export interface EffectivePolicy {
  /**
   * Tools that survive both parties. `undefined` when the agent asked for
   * none — a ceiling never grants, so a wide profile over a silent manifest
   * still yields nothing.
   */
  toolsAllow?: string[];
  denyTools: string[];
  denyCapabilities: string[];
  requireHumanFor: string[];
  /** Requested by the agent but outside the profile's allowlist. */
  droppedByCeiling: string[];
  profile?: { id: string; checksum: string };
}

const union = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])].sort();

/**
 * Combine the parties. `platform` absent means no ceiling was supplied — the
 * agent's own policy stands alone, which is what every build did before this
 * file existed.
 */
export function combinePolicies(
  agent: AgentPolicyView,
  platform?: PlatformPolicy,
): EffectivePolicy {
  if (!platform) {
    return {
      toolsAllow: agent.toolsRequested,
      denyTools: [...agent.denyTools].sort(),
      denyCapabilities: [...agent.denyCapabilities].sort(),
      requireHumanFor: [...agent.requireHumanFor].sort(),
      droppedByCeiling: [],
    };
  }

  const ceiling = platform.toolsAllow;
  const requested = agent.toolsRequested;

  // Intersection — and the asymmetry is the point. A tool the profile did not
  // allow cannot be reached by asking for it, but a tool the profile allows
  // that the agent never asked for stays unasked-for. Widening is impossible
  // in both directions.
  let toolsAllow: string[] | undefined;
  let droppedByCeiling: string[] = [];
  if (ceiling === undefined) {
    toolsAllow = requested;
  } else if (requested === undefined) {
    // A ceiling never GRANTS. An agent that asked for nothing gets nothing,
    // however wide the profile is — handing over `tools.allow` here would
    // turn "เพดาน ไม่ใช่การอนุญาต" inside out and give an agent tools its
    // manifest never mentions.
    toolsAllow = undefined;
  } else {
    const allowed = new Set(ceiling);
    toolsAllow = requested.filter((t) => allowed.has(t));
    droppedByCeiling = requested.filter((t) => !allowed.has(t));
  }

  return {
    toolsAllow,
    denyTools: union(agent.denyTools, platform.toolsDeny),
    denyCapabilities: union(agent.denyCapabilities, platform.denyCapabilities),
    requireHumanFor: union(agent.requireHumanFor, platform.requireHumanFor),
    droppedByCeiling,
    profile: { id: platform.profileId, checksum: platform.checksum },
  };
}

/**
 * Raised when a profile's named allowlist matches none of the tools the agent
 * asked for — ADR-0026 rule 3.
 *
 * The reading is not "this agent may use nothing". It is "this profile was
 * written for a different tool namespace", and the two must not look alike:
 * a ceiling that silently denies everything looks exactly like a ceiling
 * doing its job. ADR-0026 chose to make the mistake loud, and the reason it
 * gave is worth keeping in view — the dangerous half is the OTHER direction:
 *
 *   > ด้านที่อันตรายกว่าคือ `deny` ที่ไม่ตรงแล้วเงียบ ทำให้ "profile นี้ห้าม merge"
 *   > กลายเป็นความเชื่อที่ไม่จริงโดยไม่มีอะไรบอก
 *
 * A name-based `deny` only ever protects the namespace it names (rule 4).
 * Nothing here can make `github.pr.merge` guard a tool called
 * `github.merge` — so rejecting the binding is how we stop anyone believing
 * it did.
 */
export class ProfileNamespaceError extends Error {
  constructor(
    readonly profileId: string,
    readonly ceiling: string[],
    readonly requested: string[],
  ) {
    super(
      `policy: profile '${profileId}' allows none of the tools this agent asked for — ` +
        `it allows [${ceiling.join(", ")}], the agent asked for [${requested.join(", ")}]. ` +
        `A named ceiling only governs the namespace it names, so this is a profile written ` +
        `for different tool ids, not a profile that denies everything. Rejecting the binding ` +
        `rather than compiling an agent with no tools.`,
    );
    this.name = "ProfileNamespaceError";
  }
}

/** Raised when a manifest and a profile cannot be bound at all. */
export class PolicyBindingError extends Error {
  constructor(
    readonly profileId: string,
    readonly conflicts: string[],
  ) {
    super(
      `policy: binding this agent to profile '${profileId}' is invalid — ` +
        `it requires ${conflicts.join(", ")}, which the effective policy denies. ` +
        `An agent that needs a capability its ceiling forbids does not run with less; it does not run.`,
    );
    this.name = "PolicyBindingError";
  }
}

/**
 * ADR-0022: `required(agent) ∪ required(profile)` must not intersect
 * `deny(agent) ∪ deny(profile) ∪ deny(tenant)`.
 *
 * Throws rather than returning a report, on purpose. A caller that receives a
 * report can ignore it; a caller that receives an exception cannot compile an
 * agent it was told is invalid. Same reasoning as `consent/v1` rejecting a
 * tenant mismatch instead of coercing it.
 */
export function assertBindingValid(
  agent: AgentPolicyView,
  effective: EffectivePolicy,
  platform?: PlatformPolicy,
): void {
  if (!platform) return;

  const required = new Set([...agent.requiredCapabilities, ...platform.requiredCapabilities]);
  const denied = new Set(effective.denyCapabilities);
  const conflicts = [...required].filter((c) => denied.has(c)).sort();

  if (conflicts.length) throw new PolicyBindingError(platform.profileId, conflicts);

  // ADR-0026 rule 3. Deliberately narrow: an EMPTY `tools.allow` is a real
  // ceiling that grants nothing (rule 1) and must keep working, and an agent
  // that asked for no tools gives no evidence either way. Only a non-empty
  // allowlist that overlaps a non-empty request in nothing at all says
  // "wrong namespace".
  const ceiling = platform.toolsAllow;
  const requested = agent.toolsRequested;
  if (ceiling?.length && requested?.length && !effective.toolsAllow?.length) {
    throw new ProfileNamespaceError(platform.profileId, ceiling, requested);
  }
}

/* ---------- the taxonomy we are allowed to name ---------- */

/**
 * `capability/v1` v1.1.0 `CapabilityId`, and the `canonical_scope` map that
 * ADR-0024 published so that no catalog decides scope for itself.
 *
 * Copied, not derived — `agent-platform` is a schema repo with no package to
 * depend on. `tests/platform-policy.test.ts` pins the list so that a change
 * upstream shows up as a failing test here rather than as a manifest that
 * names a capability the platform has never heard of.
 *
 * `tool_calling` is in this list because we asked for it (#50) after finding
 * that free models in our own catalog cannot call tools, and ADR-0009's rule
 * *unknown = ไม่มี* left us no way to say so.
 */
export const CANONICAL_SCOPE: Readonly<Record<string, readonly string[]>> = {
  provider: ["vision", "long_context", "streaming", "tool_calling"],
  host: ["code_execution", "shell", "filesystem", "docker", "network_egress"],
  tool: ["git", "github", "browser", "mcp"],
  unscoped: ["autonomous_execution"],
};

export const CAPABILITY_IDS: readonly string[] = Object.values(CANONICAL_SCOPE).flat();

export function isKnownCapability(id: string): boolean {
  return CAPABILITY_IDS.includes(id);
}
