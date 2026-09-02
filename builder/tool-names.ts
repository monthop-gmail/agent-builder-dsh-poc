import type { ResolvedTool } from "./types.js";

/**
 * Wire names for tools.
 *
 * Manifest names are dotted and readable (`github.read`,
 * `collaboration.create_task`), but every runtime we target restricts what a
 * function name may contain — OpenAI-compatible endpoints and the Pi tool
 * registry both allow `[A-Za-z0-9_-]` only.
 *
 * This lives here rather than inside an adapter because two adapters now need
 * the identical mapping, and a second copy is how the names quietly diverge:
 * `policy.forbidden` and `approvalRequired` are written against the manifest
 * name, so an adapter that sanitises differently stops matching its own
 * policy. One function, one truth.
 */

/** Manifest tool name -> a name every supported runtime accepts. */
export function wireName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/**
 * Index tools by wire name so an adapter can resolve a model's tool call back
 * to the `ResolvedTool` — and therefore back to its manifest name, which is
 * what policy and approval are keyed on.
 *
 * Two manifest names can collide after sanitising (`a.b` and `a_b`). That
 * would silently route one tool's calls to the other, so it throws instead.
 */
export function indexByWireName(tools: ResolvedTool[]): Map<string, ResolvedTool> {
  const index = new Map<string, ResolvedTool>();
  for (const tool of tools) {
    const key = wireName(tool.name);
    const clash = index.get(key);
    if (clash && clash.name !== tool.name) {
      throw new Error(
        `tool names '${clash.name}' and '${tool.name}' both become '${key}' on the wire; rename one`,
      );
    }
    index.set(key, tool);
  }
  return index;
}
