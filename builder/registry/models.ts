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

interface CatalogEntry {
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

/** Resolve the first entry of `preferred` that the catalog knows about. */
export function resolveModel(preferred: string[]): ModelBinding {
  const requested = preferred.find((name) => hasModel(name));
  if (!requested) {
    throw new Error(
      `model: none of [${preferred.join(", ")}] is in the catalog (known: ${listModelNames().join(", ")})`,
    );
  }
  const entry = catalog[requested] as CatalogEntry;

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
