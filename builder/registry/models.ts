import type { ModelBinding } from "../types.js";

/**
 * Model Registry — `spec.model.preferred: [name]` -> a concrete endpoint.
 *
 * Two ecosystem rules shape this file:
 *
 *   B1 (gateway boundary): nothing above L2 may call an LLM provider
 *   directly. So when LLM_GATEWAY_BASE_URL is set, every model resolves to
 *   the gateway and the provider's own URL is never used. Direct routing
 *   still exists for local dev, but the Builder reports it as a boundary
 *   violation rather than doing it silently.
 *
 *   "no hardcoded model list" (owner: free-llm-registry): the seed below is
 *   a fallback for offline work, not the source of truth. Point
 *   FREE_LLM_REGISTRY_URL at the registry and it wins.
 */

export interface CatalogEntry {
  /** model id to put on the wire */
  id: string;
  /** provider base URL used only when routing direct */
  directBaseUrl: string;
  /** env var holding the provider key, used only when routing direct */
  apiKeyEnv: string;
}

/** Offline fallback only. free-llm-registry owns the real list. */
const SEED: Record<string, CatalogEntry> = {
  deepseek: {
    id: "deepseek-chat",
    directBaseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  "deepseek-reasoner": {
    id: "deepseek-reasoner",
    directBaseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  glm: {
    id: "glm-4.7",
    directBaseUrl: "https://api.z.ai/api/paas/v4",
    apiKeyEnv: "ZAI_API_KEY",
  },
  /**
   * opencode zen — an OpenAI-compatible gateway in front of a curated model
   * set. Its ids change as the curation changes, so there is nothing sensible
   * to hardcode: set OPENCODE_ZEN_MODEL, or run `agent-builder models` to ask
   * the endpoint what it serves today.
   */
  zen: {
    id: process.env.OPENCODE_ZEN_MODEL ?? "",
    directBaseUrl: "https://opencode.ai/zen/v1",
    apiKeyEnv: "OPENCODE_ZEN_API_KEY",
  },
};

let catalog: Record<string, CatalogEntry> = { ...SEED };
let catalogSource = "seed (offline fallback)";

/**
 * Load the catalog from free-llm-registry when configured. Called once by the
 * CLI before compiling; tests run against the seed.
 */
export async function loadCatalog(): Promise<{ source: string; count: number }> {
  const url = process.env.FREE_LLM_REGISTRY_URL;
  if (!url) return { source: catalogSource, count: Object.keys(catalog).length };

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`free-llm-registry: HTTP ${res.status} from ${url}`);
  const body = (await res.json()) as { models?: Record<string, CatalogEntry> };
  if (!body.models || typeof body.models !== "object") {
    throw new Error(`free-llm-registry: response has no 'models' object`);
  }
  catalog = body.models;
  catalogSource = url;
  return { source: catalogSource, count: Object.keys(catalog).length };
}

export function listModelNames(): string[] {
  return Object.keys(catalog).sort();
}
export function hasModel(name: string): boolean {
  return Object.hasOwn(catalog, name);
}
export function catalogOrigin(): string {
  return catalogSource;
}

/**
 * Resolve every entry of `preferred` the catalog knows about, in order.
 *
 * `preferred` is a preference list, so it is also a fallback list: an
 * endpoint that answers 429 all afternoon should not end the run when the
 * manifest already named an alternative. The first entry is the one the
 * agent uses; the rest travel with it for a runtime that can switch.
 *
 * Entries the catalog does not know are skipped rather than fatal — the
 * catalog is owned by free-llm-registry and changes without this repo.
 */
export function resolveModelChain(preferred: string[]): ModelBinding[] {
  const chain = preferred.filter((name) => hasModel(name)).map(bindModel);
  if (!chain.length) {
    throw new Error(
      `model: none of [${preferred.join(", ")}] is in the catalog (known: ${listModelNames().join(", ")})`,
    );
  }
  return chain;
}

/** The model the agent runs on: the first resolvable entry of `preferred`. */
export function resolveModel(preferred: string[]): ModelBinding {
  return resolveModelChain(preferred)[0] as ModelBinding;
}

function bindModel(requested: string): ModelBinding {
  const entry = catalog[requested] as CatalogEntry;
  if (!entry.id) {
    throw new Error(
      `model: catalog entry '${requested}' has no model id. ` +
        `Set the matching env var (e.g. OPENCODE_ZEN_MODEL for 'zen'), ` +
        `or run 'agent-builder models' to see what the endpoint serves.`,
    );
  }

  const gateway = process.env.LLM_GATEWAY_BASE_URL?.replace(/\/+$/, "");
  if (gateway) {
    return {
      requested,
      id: entry.id,
      baseUrl: gateway,
      apiKeyEnv: "LLM_GATEWAY_API_KEY",
      route: "gateway",
    };
  }
  return {
    requested,
    id: entry.id,
    baseUrl: entry.directBaseUrl,
    apiKeyEnv: entry.apiKeyEnv,
    route: "direct",
  };
}

/** Raw catalog entry — used by `agent-builder models` to query a live endpoint. */
export function catalogEntry(name: string): CatalogEntry | undefined {
  return catalog[name];
}

export interface RemoteModel {
  id: string;
}

/**
 * Ask an OpenAI-compatible endpoint what it actually serves. Nothing else in
 * the Builder guesses model ids, and neither does this: it reports what the
 * provider says.
 */
export async function listRemoteModels(baseUrl: string, apiKey: string): Promise<RemoteModel[]> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${baseUrl}/models — ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as { data?: RemoteModel[]; models?: RemoteModel[] };
  return body.data ?? body.models ?? [];
}
