import { createHash } from "node:crypto";
import type { CompiledAgent, ModelBinding } from "./types.js";

/**
 * What a built agent IS, as opposed to what its manifest says.
 *
 * `manifestChecksum` answers "same source?". It cannot answer "same agent?",
 * because two builds of one manifest differ whenever an input that lives
 * outside the manifest differs — the model catalog moved, or a different
 * platform profile was supplied. We found that gap in our own code and asked
 * about it; `agent-platform` ADR-0023 rule 3 made it a condition of being
 * allowed to freeze a binding at all, and ADR-0025 settled what "binding"
 * means:
 *
 *   > binding ... หมายถึง **ทั้งชุดที่ถูกแช่แข็งรวมลำดับ** ไม่ใช่ตัวที่ถูกเลือกตอนรัน
 *   > — สลับลำดับ = พฤติกรรมต่างกันภายใต้ความล้มเหลวเดียวกัน
 *
 * So order is part of identity, not an implementation detail: an agent that
 * falls back deepseek→glm and one that falls back glm→deepseek behave
 * differently the moment the first endpoint answers 429, and a checksum that
 * cannot tell them apart is a checksum that lies under exactly the conditions
 * it exists for.
 *
 * The model actually used is NOT here. ADR-0025:
 *
 *   > ตัวที่ใช้จริงเป็น **สถานะของ execution** ไม่ใช่คุณสมบัติของสิ่งที่ build
 *   > — ถ้า identity ต้องครอบมัน artifact จะไม่มี identity จนกว่าจะถูกใช้
 */

/** What goes in, and nothing else. Order within each list is significant. */
interface IdentityInput {
  manifestChecksum: string;
  chain: ModelBinding[];
  policy: CompiledAgent["policy"];
  policySource?: CompiledAgent["policySource"];
}

/**
 * The three inputs that can move while the manifest sits still:
 *
 *  1. the model catalog — `FREE_LLM_REGISTRY_URL` makes it a remote document
 *  2. the platform profile — supplied per build by whoever runs it
 *  3. the effective policy those two produce together
 *
 * Tools, skills and the system prompt are NOT hashed separately: they are
 * derived from the manifest plus the Tool/Skill registries, which are code in
 * this repo and therefore already pinned by the build itself. The list above
 * is the set of inputs the build does not carry with it.
 */
export function computeBuildIdentity(input: IdentityInput): string {
  // Built by hand rather than JSON.stringify(object) so that the field order
  // is stated here, once, instead of depending on insertion order somewhere
  // else. A change to this shape changes every identity, which is why it is
  // versioned in the prefix.
  const canonical = JSON.stringify([
    "agent-build-identity/1",
    input.manifestChecksum,
    input.chain.map((b) => [b.requested, b.id, b.baseUrl, b.route]),
    [input.policy.forbidden, input.policy.humanApproval, input.policy.deniedCapabilities],
    input.policySource
      ? [input.policySource.profileId, input.policySource.profileChecksum]
      : null,
  ]);

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
