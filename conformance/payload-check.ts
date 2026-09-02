/**
 * Conformance — ADR-0006 requirement 2.
 *
 * Every payload validated here is PRODUCED BY RUNNING THE THING. Nothing is a
 * fixture written to pass: the execution records come out of a real run of the
 * `openai-compatible` runtime against a stub endpoint that is made to answer
 * 503, so the provider switch being recorded is one that actually happened.
 *
 * The schemas are the vendored copies in `schemas/`, pinned to the commit in
 * `pinned.yaml`. Checking that the vendored copy still matches upstream is a
 * separate job (`npm run conformance:drift`) because it needs the network, and
 * a CI job that goes red when GitHub is slow teaches people to stop believing
 * red — the lesson `agent-platform` itself just wrote down in #49.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Parsed with YAML 1.2 rules — duplicate keys are an ERROR, not a last-one-wins.
 *
 * This used to need `uniqueKeys: false`, because
 * `contracts/capability/v1/capability.schema.yaml` declared `description`
 * twice at the top level and PyYAML (which upstream validates with) kept the
 * last one silently. Reported as #56, fixed upstream in `capability/v1`
 * v1.1.1, and the loosening is gone with it — a workaround left in place
 * after its reason is gone is how the NEXT duplicate goes unnoticed, which is
 * the exact argument the issue made.
 */
import ajvModule, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

/**
 * `ajv/dist/2020` and `ajv-formats` ship as CJS `export =`, so under NodeNext
 * the constructor arrives on `.default` at run time while the imported name is
 * a namespace at type time. Unwrapping once, here, keeps the rest readable.
 */
interface AjvLike {
  addSchema(schema: unknown, key: string): void;
  getSchema(ref: string): ValidateFunction | undefined;
}
type AjvCtor = new (opts: Record<string, unknown>) => AjvLike;

const Ajv2020 = ((ajvModule as unknown as { default?: unknown }).default ??
  ajvModule) as unknown as AjvCtor;
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as (ajv: AjvLike) => void;

import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";
import { loadPlatformProfile } from "../builder/platform.js";
import { CANONICAL_SCOPE } from "../builder/platform.js";
import { listToolNames, getTool } from "../builder/registry/tools.js";
import { isToolId, toolIdMap } from "../builder/tool-ids.js";
import { OpenAiCompatibleRuntime } from "../runtimes/openai-compatible/adapter.js";
import { resetCatalog, setCatalogForTest } from "../builder/registry/models.js";
import { startOpenAiStub } from "../tests/support/openai-stub.js";
import type { AgentResult, TraceEvent } from "../builder/types.js";

const here = import.meta.dirname;
const SCHEMA_ROOT = resolve(here, "schemas/contracts");
const PREFIX = "https://schemas.agent-platform.internal/";

const out = (s: string) => process.stdout.write(`${s}\n`);

let failures = 0;
let checked = 0;

function fail(what: string, detail: string): void {
  failures += 1;
  out(`  ✗ ${what}\n      ${detail}`);
}
function pass(what: string): void {
  checked += 1;
  out(`  ✓ ${what}`);
}

/* ---------- schema loading ---------- */

/**
 * Their `$id`s are `https://schemas.agent-platform.internal/...`, which nothing
 * resolves on the open internet — by design, it is a naming scheme, not a URL.
 * So every file is registered under its own `$id` and refs resolve locally.
 */
async function buildAjv(): Promise<AjvLike> {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);

  const pinned = parseYaml(await readFile(resolve(here, "pinned.yaml"), "utf8")) as {
    schemas: string[];
    commit: string;
  };

  for (const rel of pinned.schemas) {
    const doc = parseYaml(await readFile(resolve(here, "schemas", rel), "utf8")) as {
      $id?: string;
    };
    if (!doc.$id) throw new Error(`${rel} has no $id`);
    ajv.addSchema(doc, doc.$id);
  }
  return ajv;
}

function validator(ajv: AjvLike, id: string, pointer?: string): ValidateFunction {
  const ref = pointer ? `${PREFIX}${id}#${pointer}` : `${PREFIX}${id}`;
  const fn = ajv.getSchema(ref);
  if (!fn) throw new Error(`no schema registered for ${ref}`);
  return fn;
}

function check(fn: ValidateFunction, payload: unknown, what: string): boolean {
  if (fn(payload)) {
    pass(what);
    return true;
  }
  fail(
    what,
    (fn.errors ?? [])
      .map((e) => `${e.instancePath || "(root)"} ${e.message ?? ""}`)
      .join(" · "),
  );
  return false;
}

/* ---------- payload producers ---------- */

const MANIFEST_DIR = resolve(here, "../tests/compatibility/manifests");
const FIXTURE_DIR = resolve(here, "../tests/fixtures/platform");

async function compiled(file: string) {
  const loaded = await loadManifest(resolve(MANIFEST_DIR, file));
  const result = validateManifest(loaded.value);
  if (!result.ok) throw new Error(`${file}: ${result.errors.join("; ")}`);
  return { manifest: loaded.value as AgentManifest, built: compileManifest(loaded.value as AgentManifest, loaded.checksum) };
}

/**
 * Our manifest expressed as an `agent/v1` record.
 *
 * `tenant_id` and `workspace_id` are supplied by the caller because **the
 * manifest has no tenancy at all** — ADR-0007 makes them mandatory platform-
 * side, and there is nowhere in `agent/v1alpha2` for them to come from. That
 * is a gap in this repo, recorded in `platform-contract.yaml`, not something
 * to paper over with a default.
 */
function asAgentRecord(
  manifest: AgentManifest,
  built: ReturnType<typeof compileManifest>,
  ctx: { tenant: string; workspace: string },
): Record<string, unknown> {
  const policy = {
    ...(manifest.spec.policy?.forbidden?.length
      ? { deny_tools: manifest.spec.policy.forbidden }
      : {}),
    ...(manifest.spec.policy?.deniedCapabilities?.length
      ? { deny_capabilities: manifest.spec.policy.deniedCapabilities }
      : {}),
    ...(manifest.spec.humanApproval?.required?.length
      ? { require_human_for: manifest.spec.humanApproval.required }
      : {}),
  };

  return {
    agent_id: manifest.metadata.name,
    tenant_id: ctx.tenant,
    workspace_id: ctx.workspace,
    name: manifest.metadata.name,
    instructions: built.agent.systemPrompt,
    ...(manifest.spec.capabilities ? { capability_requirement: manifest.spec.capabilities } : {}),
    // #59 option A — internal names stay internal; the record carries wire
    // ToolIds. Mapped as a SET so a collision cannot hide.
    ...(built.agent.tools.length
      ? { tools: [...toolIdMap(built.agent.tools.map((t) => t.name)).values()] }
      : {}),
    ...(built.agent.mcpServers.length
      ? { mcp_servers: built.agent.mcpServers.map((m) => m.name) }
      : {}),
    ...(built.agent.policySource ? { policy_profile: built.agent.policySource.profileId } : {}),
    ...(Object.keys(policy).length ? { policy } : {}),
    status: "active",
  };
}

/** An `execution/v1` record for a run that really happened. */
function asExecutionRecord(
  result: AgentResult,
  ctx: { tenant: string; workspace: string; agent: string },
  startedAt: string,
): Record<string, unknown> {
  return {
    execution_id: `exec-${startedAt.replace(/[^0-9]/g, "").slice(0, 20)}`,
    context: {
      tenant_id: ctx.tenant,
      workspace_id: ctx.workspace,
      agent_id: ctx.agent,
      // `principal` is who ACTED. A conformance run is started by whoever ran
      // the command, so `service` is the honest answer — the CLI, not a
      // person and not the agent. `agent_id` beside it says which agent that
      // service then ran, which is a different question (ADR-0017).
      principal: { type: "service", id: "agent-builder-conformance" },
      request_id: "conformance-run",
    },
    execution_mode: "native",
    provider_id: result.providerId ?? null,
    ...(result.providerSwitches ? { provider_switches: result.providerSwitches } : {}),
    state: "succeeded",
    created_at: startedAt,
  };
}

/* ---------- the checks ---------- */

async function main(): Promise<void> {
  const ajv = await buildAjv();
  const ctx = { tenant: "conformance", workspace: "agent-builder" };

  out("\nvendored schemas — parseable under YAML 1.2, not just PyYAML");
  {
    // `buildAjv()` already parsed every file strictly to get here, so a
    // duplicate key upstream would have thrown before this line. Saying so
    // out loud keeps the guarantee visible: the parser IS the check now,
    // which is stronger than a scan that has to be remembered.
    const pinned = parseYaml(await readFile(resolve(here, "pinned.yaml"), "utf8")) as {
      schemas: string[];
    };
    pass(`every vendored schema parsed strictly (${pinned.schemas.length} files)`);
  }

  out("\ncapability/v1 — the taxonomy we name");
  {
    const doc = parseYaml(
      await readFile(resolve(SCHEMA_ROOT, "capability/v1/capability.schema.yaml"), "utf8"),
    ) as {
      $defs: {
        CapabilityId: { enum: string[] };
        canonical_scope?: Record<string, string[]>;
      };
    };

    const theirs = doc.$defs.CapabilityId.enum;
    const ours = Object.values(CANONICAL_SCOPE).flat();
    const unknown = ours.filter((c) => !theirs.includes(c));
    if (unknown.length) fail("our capability list is a subset of theirs", `unknown: ${unknown.join(", ")}`);
    else pass(`our capability list is a subset of theirs (${ours.length} ids)`);

    // ADR-0024 published `canonical_scope` so no catalog decides scope for
    // itself. Copying it means it can drift; comparing it means it cannot.
    const same =
      JSON.stringify(doc.$defs.canonical_scope ?? {}) === JSON.stringify(CANONICAL_SCOPE);
    if (same) pass("canonical_scope matches upstream exactly");
    else
      fail(
        "canonical_scope matches upstream exactly",
        `ours=${JSON.stringify(CANONICAL_SCOPE)} theirs=${JSON.stringify(doc.$defs.canonical_scope)}`,
      );

    // Every capability a tool claims must exist upstream, or a ceiling written
    // against the real taxonomy could never withhold it.
    const claimed = new Set(listToolNames().flatMap((n) => getTool(n).capabilities));
    const bad = [...claimed].filter((c) => !theirs.includes(c));
    if (bad.length) fail("every tool capability is a real CapabilityId", bad.join(", "));
    else pass(`every tool capability is a real CapabilityId (${claimed.size} distinct)`);
  }

  out("\nprofile/v1 — ceilings we consume");
  {
    const fn = validator(ajv, "profile/v1/profile.schema.yaml");

    // One is upstream's own file vendored verbatim, the other is ours. Both
    // must validate now — ours used to fail because it spoke internal names,
    // which is the gap #59 was opened about.
    for (const file of ["coding-agent.profile.yaml", "narrow.profile.yaml"]) {
      const doc = parseYaml(await readFile(resolve(FIXTURE_DIR, file), "utf8"));
      check(fn, doc, `${file} is a valid profile/v1 instance`);
      // ...and the Builder must be able to read what the schema accepts.
      await loadPlatformProfile(resolve(FIXTURE_DIR, file));
    }
  }

  out("\nexecution/v1 — records from runs that really happened");
  {
    const fn = validator(ajv, "execution/v1/execution.schema.yaml");
    const stub = await startOpenAiStub();
    const previousKey = process.env.CONFORMANCE_KEY;
    process.env.CONFORMANCE_KEY = "stub-key";

    try {
      setCatalogForTest({
        primary: { id: "primary-1", directBaseUrl: stub.baseUrl, apiKeyEnv: "CONFORMANCE_KEY" },
        secondary: { id: "secondary-1", directBaseUrl: stub.baseUrl, apiKeyEnv: "CONFORMANCE_KEY" },
      });

      const { built } = await compiledInline(["primary", "secondary"]);
      const runtime = new OpenAiCompatibleRuntime();
      const trace: TraceEvent[] = [];
      const runCtx = {
        requestApproval: async () => "deny" as const,
        onTrace: (e: TraceEvent) => trace.push(e),
      };

      // 1. a plain run — no switch, so the field must be ABSENT, not []
      let handle = await runtime.createAgent(built.agent);
      const startedA = new Date().toISOString();
      const plain = await runtime.run(handle, "hello", runCtx);
      await handle.dispose();
      const recordA = asExecutionRecord(plain, { ...ctx, agent: built.agent.name }, startedA);
      if ("provider_switches" in recordA)
        fail("a run with no switch omits provider_switches", "the field was present");
      else pass("a run with no switch omits provider_switches");
      check(fn, recordA, "execution record for a plain run");

      // 2. force the primary to fail so the runtime really moves
      stub.reset();
      stub.failModels = { "primary-1": 503 };
      handle = await runtime.createAgent(built.agent);
      const startedB = new Date().toISOString();
      const switched = await runtime.run(handle, "hello", runCtx);
      await handle.dispose();

      if (!switched.providerSwitches?.length)
        fail("the forced failure produced a real switch", "no provider_switches recorded");
      else pass(`the forced failure produced a real switch (${switched.providerSwitches.length})`);

      const recordB = asExecutionRecord(switched, { ...ctx, agent: built.agent.name }, startedB);
      check(fn, recordB, "execution record for a run that switched provider");
    } finally {
      if (previousKey === undefined) delete process.env.CONFORMANCE_KEY;
      else process.env.CONFORMANCE_KEY = previousKey;
      await stub.close();
      resetCatalog();
    }
  }

  out("\ntool/v1 — internal name to wire ToolId (#59 option A)");
  {
    const names = listToolNames();
    const ids = toolIdMap(names);   // throws on collision
    const bad = [...ids.values()].filter((id) => !isToolId(id));
    if (bad.length) fail("every registry tool maps to a valid ToolId", bad.join(", "));
    else pass(`every registry tool maps to a valid ToolId (${names.length} tools)`);

    // MCP tools are namespaced `<server>.<tool>` at discovery, which is what
    // makes them legal — probed against two real servers for #59, 29/29 bare
    // names, 29/29 valid once namespaced.
    const mcpish = toolIdMap(["collaboration.post_message", "filesystem.read_file"]);
    const mcpBad = [...mcpish.values()].filter((id) => !isToolId(id));
    if (mcpBad.length) fail("MCP-shaped names are valid ToolIds", mcpBad.join(", "));
    else pass("MCP-shaped names are valid ToolIds");
  }

  out("\nagent/v1 — records this Builder would hand to the platform");
  {
    const fn = validator(ajv, "agent/v1/agent.schema.yaml");
    for (const file of ["v1alpha2-minimal.yaml", "v1alpha2-policy.yaml", "v1alpha2-tools.yaml"]) {
      const { manifest, built } = await compiled(file);
      check(fn, asAgentRecord(manifest, built, ctx), `${file} as an agent/v1 record`);
    }
  }

  out(`\n${failures ? "FAILED" : "OK"} — ${checked} checks passed, ${failures} failed\n`);
  if (failures) process.exit(1);
}

/** A manifest built in memory, so the catalog names above are the ones used. */
async function compiledInline(models: string[]) {
  const value = {
    apiVersion: "agent/v1alpha2",
    kind: "Agent",
    metadata: { name: "conformance-runner", version: "0.1.0" },
    spec: {
      purpose: { primary: "produce an execution record from a real run" },
      model: { preferred: models },
      autonomy: { level: 1 },
      tools: { allowed: ["current_time"] },
    },
  };
  const result = validateManifest(value);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return { built: compileManifest(value as AgentManifest, "conformance") };
}

await main();
