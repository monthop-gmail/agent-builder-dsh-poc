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
 * ADR-0027 then made the transformation itself part of the contract, because
 * a mapping each consumer invents is a mapping two consumers disagree about —
 * and then a profile's named deny covers one of them and not the other. The
 * six rules in `tool/v1` `platform_rules` are implemented here, and
 * `tests/tool-identity.test.ts` checks each one by number.
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
 * ADR-0027 rule 2: lowercase, then every character outside `[a-z0-9_]` becomes
 * `_` **one at a time**.
 *
 * No collapsing of runs: `a--b` is `a__b`, not `a_b`. Collapsing would invent
 * collisions that the input did not have, and `a__b` already satisfies the
 * pattern, so the shorter form buys nothing and costs correctness.
 */
function sanitiseSegment(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

/** Raised when a name cannot be transformed without guessing (ADR-0027 rule 3). */
export class ToolIdUnmappableError extends Error {
  constructor(
    readonly name: string,
    readonly attempted: string,
  ) {
    super(
      `tool id: '${name}' has no deterministic ToolId (best effort '${attempted}'). ` +
        `A segment must start with a letter, and inventing a prefix would make the ` +
        `result differ between implementations — which is the exact failure the rule ` +
        `exists to prevent. Add an explicit mapping instead.`,
    );
    this.name = "ToolIdUnmappableError";
  }
}

/** ADR-0027 rule 4 — raised when two different tools would land on one id. */
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
  // ADR-0027 rule 2 step 3: prepend a namespace segment. For MCP that segment
  // is the server id, which the discovery path has already put in front.
  const segments = parts.length > 1 ? parts : [BUILTIN_NAMESPACE, ...parts];
  const id = segments.join(".");

  // ADR-0027 rule 3: still not a ToolId — `2fa_setup` stays illegal however it
  // is namespaced, because the LAST segment starts with a digit. Reject and
  // make someone write the mapping down. Guessing a prefix here would produce
  // a different id in every implementation that guessed differently.
  if (!TOOL_ID.test(id)) throw new ToolIdUnmappableError(name, id);
  return id;
}

/**
 * Map a whole set at once, refusing collisions.
 *
 * Callers pass every name they are about to put on the wire together, because
 * a collision is a property of the SET — checking one name at a time can never
 * see it. Same reason `tool-names.ts` checks the model-facing wire names as a
 * set rather than one at a time.
 *
 * Refusing collisions is also what makes ADR-0027 rule 5 hold: a map with no
 * two names on one id is invertible, so the original name is always
 * recoverable from the id it was given.
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
