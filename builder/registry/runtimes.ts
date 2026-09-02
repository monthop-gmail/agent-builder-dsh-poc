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
  pi: async () => {
    const { PiRuntime } = await import("../../runtimes/pi/adapter.js");
    return new PiRuntime();
  },
};

/**
 * Runtimes the conformance suite runs in full.
 *
 * "Offline" means no credential and no outbound network — not "no model". A
 * runtime whose model endpoint is an env var qualifies, because the suite can
 * point it at a stub on 127.0.0.1. `pi` is here for exactly that reason: it
 * reaches its model through the Builder's ModelBinding like every other
 * adapter, so CI can give it a local endpoint and still exercise the real
 * harness. A runtime left out of this list is a runtime nobody is testing.
 */
export const OFFLINE_RUNTIMES = ["dsh", "mock", "pi"];

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
