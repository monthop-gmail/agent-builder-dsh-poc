/**
 * Generate schema/agent-manifest.schema.json from the zod schema.
 *
 * The zod schema is the single source of truth. This file exists so editors
 * and non-TypeScript consumers get the same contract, and CI fails if the
 * committed JSON has drifted (`npm run schema && git diff --exit-code`).
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { API_VERSION, manifestZodSchema } from "../builder/validator.js";

const json = zodToJsonSchema(manifestZodSchema, {
  name: "AgentManifest",
  $refStrategy: "none",
});

const out = resolve(import.meta.dirname, "../schema/agent-manifest.schema.json");
await writeFile(
  out,
  `${JSON.stringify({ $comment: `generated from builder/validator.ts — do not edit by hand (${API_VERSION})`, ...json }, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`wrote ${out}\n`);
