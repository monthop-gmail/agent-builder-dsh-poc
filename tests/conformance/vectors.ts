import { resolve } from "node:path";
import { loadManifest } from "../../builder/loader.js";
import { validateManifest, type AgentManifest } from "../../builder/validator.js";
import { compileManifest } from "../../builder/compiler.js";
import type { CompiledAgent } from "../../builder/types.js";

/**
 * The shared conformance vectors.
 *
 * Every runtime is tested against this one set, so "it works on Pi" and "it
 * works on DSH" mean the same thing. They live here rather than in
 * `manifests/` because those are examples for people to copy: a fixture that
 * doubles as documentation gets edited for readability and quietly changes
 * what the suite proves.
 *
 * Each vector isolates ONE property. `expected` is what the Builder must
 * produce from it — asserted in `vectors.test.ts`, so a vector that stops
 * exercising the thing its name claims fails loudly instead of passing
 * everywhere for the wrong reason.
 */

export interface VectorExpectation {
  autonomyLevel: number;
  /** Tool names the runtime should receive, sorted. */
  tools: string[];
  /** Tool names needing a human on every call, sorted. */
  approvalRequired: string[];
  /** Names the manifest granted and policy then withheld. */
  droppedByPolicy: string[];
  /** Entries of `spec.model.preferred` beyond the first that resolved. */
  modelFallbacks: number;
  mcpServers: string[];
  audit: boolean;
}

export interface Vector {
  name: string;
  file: string;
  /** What this vector exists to pin down. */
  isolates: string;
  expected: VectorExpectation;
}

const dir = resolve(import.meta.dirname, "vectors");

export const VECTORS: Vector[] = [
  {
    name: "minimal",
    file: "minimal.yaml",
    isolates: "a manifest that asks for nothing but a model",
    expected: { autonomyLevel: 1, tools: [], approvalRequired: [], droppedByPolicy: [], modelFallbacks: 0, mcpServers: [], audit: false },
  },
  {
    name: "observer",
    file: "observer.yaml",
    isolates: "autonomy 0 — even a read tool needs a human",
    expected: { autonomyLevel: 0, tools: ["current_time"], approvalRequired: ["current_time"], droppedByPolicy: [], modelFallbacks: 0, mcpServers: [], audit: false },
  },
  {
    name: "reader",
    file: "reader.yaml",
    isolates: "autonomy 1 — read runs unattended",
    expected: { autonomyLevel: 1, tools: ["current_time", "github.read"], approvalRequired: [], droppedByPolicy: [], modelFallbacks: 0, mcpServers: [], audit: false },
  },
  {
    name: "proposer",
    file: "proposer.yaml",
    isolates: "autonomy 2 — write runs, irreversible asks",
    expected: { autonomyLevel: 2, tools: ["github.comment", "github.merge", "github.read"], approvalRequired: ["github.merge"], droppedByPolicy: [], modelFallbacks: 0, mcpServers: [], audit: false },
  },
  {
    name: "actor",
    file: "actor.yaml",
    isolates: "autonomy 3 — nothing needs asking",
    expected: { autonomyLevel: 3, tools: ["github.comment", "github.merge", "github.read"], approvalRequired: [], droppedByPolicy: [], modelFallbacks: 0, mcpServers: [], audit: false },
  },
  {
    name: "approval",
    file: "approval.yaml",
    isolates: "humanApproval outranks autonomy",
    expected: { autonomyLevel: 3, tools: ["github.comment", "github.read"], approvalRequired: ["github.comment"], droppedByPolicy: [], modelFallbacks: 0, mcpServers: [], audit: true },
  },
  {
    name: "forbidden",
    file: "forbidden.yaml",
    isolates: "policy.forbidden never reaches a runtime",
    expected: { autonomyLevel: 3, tools: ["github.comment", "github.read"], approvalRequired: [], droppedByPolicy: ["github.merge"], modelFallbacks: 0, mcpServers: [], audit: false },
  },
  {
    name: "fallback",
    file: "fallback.yaml",
    isolates: "spec.model.preferred is a chain, not a choice",
    expected: { autonomyLevel: 1, tools: ["current_time"], approvalRequired: [], droppedByPolicy: [], modelFallbacks: 2, mcpServers: [], audit: false },
  },
  {
    name: "audit-on",
    file: "audit-on.yaml",
    isolates: "audit.required: true",
    expected: { autonomyLevel: 1, tools: ["current_time"], approvalRequired: [], droppedByPolicy: [], modelFallbacks: 0, mcpServers: [], audit: true },
  },
  {
    name: "audit-off",
    file: "audit-off.yaml",
    isolates: "audit off must be silent",
    expected: { autonomyLevel: 1, tools: ["current_time"], approvalRequired: [], droppedByPolicy: [], modelFallbacks: 0, mcpServers: [], audit: false },
  },
  {
    name: "mcp",
    file: "mcp.yaml",
    isolates: "an MCP server the runtime has to dial",
    expected: { autonomyLevel: 1, tools: ["current_time"], approvalRequired: [], droppedByPolicy: [], modelFallbacks: 0, mcpServers: ["filesystem"], audit: false },
  },
];

export function vector(name: string): Vector {
  const found = VECTORS.find((v) => v.name === name);
  if (!found) throw new Error(`no conformance vector named '${name}'`);
  return found;
}

export interface CompiledVector {
  agent: CompiledAgent;
  droppedByPolicy: string[];
}

export async function compileVector(name: string): Promise<CompiledVector> {
  const target = vector(name);
  const loaded = await loadManifest(resolve(dir, target.file));
  const result = validateManifest(loaded.value);
  if (!result.ok) throw new Error(`vector '${name}' is invalid: ${result.errors.join("; ")}`);
  const compiled = compileManifest(loaded.value as AgentManifest, loaded.checksum);
  return { agent: compiled.agent, droppedByPolicy: compiled.droppedByPolicy };
}
