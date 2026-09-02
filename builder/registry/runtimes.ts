import type { AgentRuntime } from "../types.js";

/**
 * Runtime Registry — the ONE place that knows which runtimes exist.
 *
 * The Validator asks this module rather than keeping its own list, so adding
 * a runtime is a one-file change. (The predecessor repo kept the list in two
 * places and its README claimed otherwise.)
 */

const LOADERS: Record<string, () => Promise<AgentRuntime>> = {
  mock: async () => {
    const { MockRuntime } = await import("../../runtimes/mock/adapter.js");
    return new MockRuntime();
  },
  dsh: async () => {
    const { DshRuntime } = await import("../../runtimes/dsh/adapter.js");
    return new DshRuntime();
  },
};

/** Runtimes that need no credentials or network — safe for CI. */
export const OFFLINE_RUNTIMES = ["mock"];

export function listRuntimeIds(): string[] {
  return Object.keys(LOADERS).sort();
}
export function hasRuntime(id: string): boolean {
  return Object.hasOwn(LOADERS, id);
}
export async function getRuntime(id: string): Promise<AgentRuntime> {
  const load = LOADERS[id];
  if (!load) {
    throw new Error(`No runtime registered for '${id}' (known: ${listRuntimeIds().join(", ")})`);
  }
  return load();
}
