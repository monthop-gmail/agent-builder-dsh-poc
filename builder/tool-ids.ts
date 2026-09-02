/**
 * Internal tool name → `tool/v1` `ToolId` on the wire.
 *
 * `agent-platform` #59 option A: the name a manifest writes and the name that
 * crosses a contract boundary do not have to be the same string, and the
 * mapping lives in exactly one place. `devfactory-core` set the precedent with
 * `decision.WIRE_FIELD_NAMES`.
 *
 * This is why `agent/v1alpha2` does NOT have to be bumped to satisfy
 * `tool/v1`: nothing a user writes changes.
 *
 *     ToolId: ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$
 *
 * Note what that pattern demands beyond "has a dot": every segment must be
 * lowercase `[a-z0-9_]`. Probing real MCP servers for #59 found 29/29 tools
 * with bare names (fine — the server name supplies the namespace) but also
 * whole servers using `kebab-case` (Canva) and `SCREAMING_SNAKE` (Composio),
 * which no amount of prefixing fixes. So this file sanitises as well as
 * namespaces.
 */

const TOOL_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const SEGMENT = /^[a-z][a-z0-9_]*$/;

/**
 * The namespace for tools this Builder ships itself.
 *
 * `builder`, not `dsh`. The registry is runtime-neutral — the same
 * `calculator` is handed to `pi`, `acp` and `mock` — so naming it after one
 * runtime would claim something untrue, and `tool/v1` says the first segment
 * is a domain (`github.` `fs.` `shell.`), not an owner.
 */
export const BUILTIN_NAMESPACE = "builder";

/**
 * Names that get a hand-written id instead of a mechanical one.
 *
 * `tool/v1` asks that an id read as `domain.action` so that "อ่านแล้วต้องเดา
 * ผลกระทบได้". `builder.web_search` satisfies the pattern and says nothing;
 * `web.search` says what it touches. Mechanical prefixing is the fallback,
 * not the goal.
 */
const EXPLICIT: Record<string, string> = {
  calculator: "math.evaluate",
  current_time: "time.now",
  web_search: "web.search",
};

/**
 * Make one path segment legal: lowercase, and anything outside `[a-z0-9_]`
 * becomes `_`. Leading digits get a prefix because a segment must start with a
 * letter.
 */
function sanitiseSegment(raw: string): string {
  const lowered = raw.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return /^[a-z]/.test(lowered) ? lowered : `t_${lowered}`;
}

/** Raised when two different tools would land on the same wire id. */
export class ToolIdCollisionError extends Error {
  constructor(
    readonly id: string,
    readonly names: string[],
  ) {
    super(
      `tool id: '${names.join("' and '")}' both map to '${id}'. ` +
        `The collision comes from OUR sanitising, not from the server — letting one win ` +
        `would put two different tools behind one id, and a policy written about one ` +
        `would silently govern the other.`,
    );
    this.name = "ToolIdCollisionError";
  }
}

/**
 * The wire id for one internal name.
 *
 * Already-valid ids pass through untouched — `github.read` is a legal ToolId
 * and rewriting it to `builder.github_read` would throw away the accidental
 * alignment with the ecosystem's own `github.*` namespace.
 */
export function toolIdFor(name: string): string {
  const explicit = EXPLICIT[name];
  if (explicit) return explicit;
  if (TOOL_ID.test(name)) return name;

  const parts = name.split(".").filter(Boolean).map(sanitiseSegment);
  const segments = parts.length > 1 ? parts : [BUILTIN_NAMESPACE, ...parts];
  const id = segments.join(".");

  if (!TOOL_ID.test(id)) {
    throw new Error(`tool id: '${name}' could not be mapped to a valid ToolId (got '${id}')`);
  }
  return id;
}

/**
 * Map a whole set at once, refusing collisions.
 *
 * Callers pass every name they are about to put on the wire together, because
 * a collision is a property of the SET — checking one name at a time can never
 * see it. Same reason `tool-names.ts` checks the model-facing wire names as a
 * set rather than one at a time.
 */
export function toolIdMap(names: readonly string[]): Map<string, string> {
  const byId = new Map<string, string[]>();
  const map = new Map<string, string>();

  for (const name of names) {
    const id = toolIdFor(name);
    map.set(name, id);
    byId.set(id, [...(byId.get(id) ?? []), name]);
  }

  for (const [id, owners] of byId) {
    if (owners.length > 1) throw new ToolIdCollisionError(id, owners);
  }
  return map;
}

/** For tests and for the conformance check — the pattern, in one place. */
export function isToolId(value: string): boolean {
  return TOOL_ID.test(value);
}

export function isToolIdSegment(value: string): boolean {
  return SEGMENT.test(value);
}
