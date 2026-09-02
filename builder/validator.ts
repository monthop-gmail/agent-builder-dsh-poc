import { z } from "zod";
import { hasTool, listToolNames } from "./registry/tools.js";
import { hasSkill, listSkillNames } from "./registry/skills.js";
import { hasMcpServer, listMcpServerNames } from "./registry/mcp.js";
import { hasModel, listModelNames } from "./registry/models.js";
import { AUTONOMY_LEVELS, isKnownAutonomyLevel } from "./registry/policy.js";

/**
 * Validator — checks a manifest against the agent/v1alpha2 contract and
 * against the registries.
 *
 * Two deliberate choices:
 *
 *  - `strictObject` everywhere. An unknown field is an error, not a warning.
 *    That is what stops a runtime-specific field ever being written into a
 *    manifest and quietly becoming load-bearing.
 *
 *  - There is no `spec.runtime`. A runtime is a BUILD TARGET (`--target dsh`),
 *    the same way `--target` is a compiler flag and not a line in the source
 *    file. Manifests carrying one are rejected with an explanation.
 */

export const API_VERSION = "agent/v1alpha2";

const kebab = /^[a-z][a-z0-9-]*$/;
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/;

const manifestSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  kind: z.literal("Agent"),
  metadata: z.strictObject({
    name: z.string().regex(kebab, "must be lowercase kebab-case"),
    version: z.string().regex(semver, "must be semver, e.g. 0.1.0"),
    description: z.string().optional(),
  }),
  spec: z.strictObject({
    purpose: z.strictObject({
      primary: z.string().min(1),
    }),
    model: z.strictObject({
      preferred: z.array(z.string().min(1)).min(1, "list at least one model"),
    }),
    autonomy: z.strictObject({
      level: z.number().int(),
    }),
    system: z
      .strictObject({
        instructions: z.string().min(1),
      })
      .optional(),
    tools: z
      .strictObject({
        allowed: z.array(z.string().min(1)),
      })
      .optional(),
    skills: z.array(z.string().min(1)).optional(),
    mcp: z
      .strictObject({
        servers: z.array(z.string().min(1)),
      })
      .optional(),
    policy: z
      .strictObject({
        forbidden: z.array(z.string().min(1)),
      })
      .optional(),
    humanApproval: z
      .strictObject({
        required: z.array(z.string().min(1)),
      })
      .optional(),
    audit: z
      .strictObject({
        required: z.boolean(),
      })
      .optional(),
    subagents: z
      .array(
        z.strictObject({
          name: z.string().regex(kebab),
          role: z.string().min(1),
        }),
      )
      .optional(),
  }),
});

export type AgentManifest = z.infer<typeof manifestSchema>;
export const manifestZodSchema = manifestSchema;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateManifest(candidate: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // A friendlier message than "unrecognized key" for the one field people
  // will keep trying to write, because the predecessor schema had it.
  const spec = (candidate as { spec?: Record<string, unknown> })?.spec;
  if (spec && Object.hasOwn(spec, "runtime")) {
    errors.push(
      "spec.runtime: a runtime is a build target, not part of the agent. " +
        "Remove it and pass `--target <runtime>` to `agent-builder build` instead.",
    );
  }

  const parsed = manifestSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const where = issue.path.length ? issue.path.join(".") : "(root)";
      errors.push(`schema: ${where}: ${issue.message}`);
    }
    return { ok: false, errors, warnings };
  }

  const m = parsed.data;

  for (const name of m.spec.model.preferred) {
    if (!hasModel(name)) {
      warnings.push(`model: '${name}' is not in the current catalog (known: ${listModelNames().join(", ")})`);
    }
  }
  if (!m.spec.model.preferred.some((n) => hasModel(n))) {
    errors.push(
      `model: none of [${m.spec.model.preferred.join(", ")}] is in the catalog (known: ${listModelNames().join(", ")})`,
    );
  }

  if (!isKnownAutonomyLevel(m.spec.autonomy.level)) {
    errors.push(
      `autonomy.level: ${m.spec.autonomy.level} is not defined (known: ${AUTONOMY_LEVELS.map((l) => `${l.level}=${l.name}`).join(", ")})`,
    );
  }

  for (const name of m.spec.tools?.allowed ?? []) {
    if (!hasTool(name)) {
      errors.push(`tools.allowed: '${name}' not in Tool Registry (known: ${listToolNames().join(", ")})`);
    }
  }
  for (const name of m.spec.skills ?? []) {
    if (!hasSkill(name)) {
      errors.push(`skills: '${name}' not in Skill Registry (known: ${listSkillNames().join(", ")})`);
    }
  }
  for (const name of m.spec.mcp?.servers ?? []) {
    if (!hasMcpServer(name)) {
      errors.push(`mcp.servers: '${name}' not in MCP Registry (known: ${listMcpServerNames().join(", ")})`);
    }
  }

  // A forbidden name that no tool answers to protects nothing — usually a typo.
  // MCP tools are the exception: a server only reveals its tools once
  // connected, so `<server>.<tool>` cannot be checked here and is accepted as
  // long as the server itself is declared.
  const declaredServers = new Set(m.spec.mcp?.servers ?? []);
  const isMcpScoped = (name: string) => {
    const server = name.split(".")[0];
    return server !== undefined && declaredServers.has(server);
  };

  for (const name of m.spec.policy?.forbidden ?? []) {
    if (!hasTool(name) && !isMcpScoped(name)) {
      warnings.push(`policy.forbidden: '${name}' matches no known tool — it protects nothing`);
    }
  }
  for (const name of m.spec.humanApproval?.required ?? []) {
    if (!hasTool(name) && !isMcpScoped(name)) {
      warnings.push(`humanApproval.required: '${name}' matches no known tool — it gates nothing`);
    }
  }

  if (!m.spec.system?.instructions && !(m.spec.skills ?? []).length) {
    warnings.push(
      "system: no instructions and no skills — the agent's whole prompt will be its purpose line",
    );
  }
  if (!(m.spec.tools?.allowed ?? []).length && !(m.spec.mcp?.servers ?? []).length) {
    warnings.push("capabilities: no tools and no MCP servers — the model can only answer from memory");
  }
  if ((m.spec.subagents ?? []).length) {
    warnings.push(`subagents: declared but not compiled yet (planned for P5)`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
