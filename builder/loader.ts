import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";

export interface LoadedManifest {
  /** Parsed object, uninterpreted. Validation is the Validator's job. */
  value: unknown;
  /** sha256 of the raw bytes — the portability test pins this. */
  checksum: string;
  path: string;
}

/** Loader: raw file -> plain object + checksum. Accepts .yaml / .yml / .json. */
export async function loadManifest(path: string): Promise<LoadedManifest> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`Cannot read manifest '${path}': ${(err as Error).message}`);
  }

  const checksum = createHash("sha256").update(raw, "utf8").digest("hex");
  const value = path.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
  return { value, checksum, path };
}
