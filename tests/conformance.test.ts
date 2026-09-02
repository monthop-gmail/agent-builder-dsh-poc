import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getRuntime, listRuntimeIds, OFFLINE_RUNTIMES } from "../builder/registry/runtimes.js";
import {
  compileVector,
  GATED_TOOL,
  GATED_VECTORS,
  TOOLED_VECTORS,
  VECTORS,
} from "./conformance/vectors.js";
import { classifyGaps } from "../builder/registry/capabilities.js";
import { wireName } from "../builder/tool-names.js";
import { startOpenAiStub, type OpenAiStub } from "./support/openai-stub.js";
import type { ApprovalRequest, TraceEvent } from "../builder/types.js";

/**
 * The conformance suite every adapter must pass.
 *
 * Write the adapter against this, not the other way round.
 *
 * Every adapter reaches its model through `ModelBinding.baseUrl`, so the
 * suite stands one stub endpoint up on 127.0.0.1 and points the gateway at
 * it. That is what makes "needs credentials" a non-reason to skip: a runtime
 * left out of OFFLINE_RUNTIMES is a runtime this file is not actually
 * checking, and an untested adapter looks exactly like a passing one.
 *
 * Fixtures come from `conformance/vectors/`, not from `manifests/`. Those are
 * examples for people to copy, and a fixture that doubles as documentation
 * gets edited for readability — quietly changing what this file proves.
 */

let stub: OpenAiStub;
let acpDir: string;

beforeAll(async () => {
  stub = await startOpenAiStub();
  process.env.LLM_GATEWAY_BASE_URL = stub.baseUrl;
  process.env.LLM_GATEWAY_API_KEY = "stub-key";

  // `acp` drives someone else's agent, so its stand-in is a process rather
  // than an endpoint. Same principle: give the adapter a local peer instead
  // of skipping it.
  acpDir = await mkdtemp(join(tmpdir(), "agent-builder-conformance-acp-"));
  const stubAgent = resolve(import.meta.dirname, "support/acp-stub-agent.mjs");
  process.env.ACP_AGENT_COMMAND = process.execPath;
  process.env.ACP_AGENT_ARGS = stubAgent;
  process.env.ACP_STUB_STATE = join(acpDir, "sessions.json");

  // `dsh` gets the same stand-in. That checks the adapter's own contract —
  // it composes a patch, launches, drives the session, cleans up — and not
  // the harness, which is a 250 MB install CI does not carry. Whether the
  // real binary accepts the patch is verified by hand; the command is in
  // docs/poc-review-2026-09-02.md §14.
  process.env.DSH_COMMAND = process.execPath;
  process.env.DSH_ARGS = stubAgent;
});

afterAll(async () => {
  for (const key of [
    "LLM_GATEWAY_BASE_URL",
    "LLM_GATEWAY_API_KEY",
    "ACP_AGENT_COMMAND",
    "ACP_AGENT_ARGS",
    "ACP_STUB_STATE",
    "DSH_COMMAND",
    "DSH_ARGS",
  ]) {
    delete process.env[key];
  }
  await stub.close();
  await rm(acpDir, { recursive: true, force: true });
});

beforeEach(() => stub.reset());
afterEach(() => {
  delete process.env.ACP_STUB_TOOL;
});

const compiled = async (name: string) => (await compileVector(name)).agent;

function ctx(decision: "allow" | "deny", seen: ApprovalRequest[], trace: TraceEvent[]) {
  return {
    async requestApproval(req: ApprovalRequest) {
      seen.push(req);
      return decision;
    },
    onTrace(e: TraceEvent) {
      trace.push(e);
    },
  };
}

describe.each(listRuntimeIds())("Runtime conformance — %s", (id) => {
  const offline = OFFLINE_RUNTIMES.includes(id);
  const maybe = offline ? it : it.skip;

  it("is registered and reports its own id", async () => {
    const runtime = await getRuntime(id);
    expect(runtime.id).toBe(id);
  });

  it("declares what it cannot do rather than failing later", async () => {
    const runtime = await getRuntime(id);
    expect(Array.isArray(runtime.unsupported(await compiled("minimal")))).toBe(true);
  });

  it("names only gaps the registry has classified", async () => {
    // An unclassified name is refused at runtime, so a typo here would take a
    // target offline in a way that reads like a policy decision.
    const runtime = await getRuntime(id);
    // Every vector, not a sample: a gap name only appears when a manifest
    // asks for the thing it is about.
    for (const target of VECTORS) {
      const report = classifyGaps(runtime.unsupported(await compiled(target.name)));
      expect(report.unknown, `${id} on vector '${target.name}'`).toEqual([]);
    }
  });

  // Lifecycle over the WHOLE vector set. It is the cheap half — no prompt, no
  // peer traffic — so it can afford to be exhaustive, and "this target cannot
  // even open a session for that shape of manifest" is worth knowing for all
  // eleven rather than for the two a sample would reach.
  maybe.each(VECTORS.map((v) => v.name))("opens and closes a session for vector '%s'", async (name) => {
    const runtime = await getRuntime(id);
    const handle = await runtime.createAgent(await compiled(name));
    expect(handle.runtimeId).toBe(id);
    await expect(handle.dispose()).resolves.toBeUndefined();
  });

  maybe.each([...TOOLED_VECTORS])("hands '%s' exactly the tools the Builder granted", async (name) => {
    const agent = await compiled(name);
    const runtime = await getRuntime(id);
    const handle = await runtime.createAgent(agent);
    try {
      // What the Builder withheld must not reappear anywhere downstream. The
      // wire check below only covers targets that carry local tools at all;
      // this one holds for every target, which is the point of withholding
      // at the Builder rather than asking each adapter to remember.
      for (const withheld of agent.policy.forbidden) {
        expect(agent.tools.map((t) => t.name)).not.toContain(withheld);
      }

      if (runtime.unsupported(agent).includes("tools.local")) return;

      stub.reset();
      await runtime.run(handle, "list what you can do", ctx("deny", [], []));
      const offered = stub.requests[0]?.toolNames;
      // A target that reaches the model through the stub must offer exactly
      // the granted set — not a superset, which is how a forbidden tool comes
      // back through a door nobody was watching.
      if (offered) {
        expect(offered.toSorted()).toEqual(agent.tools.map((t) => wireName(t.name)).toSorted());
      }
    } finally {
      await handle.dispose();
    }
  });

  maybe.each([...GATED_VECTORS])("asks before the gated tool in '%s', and honours a denial", async (name) => {
    const agent = await compiled(name);
    const gated = GATED_TOOL[name] as { manifest: string; wire: string; args: Record<string, unknown> };
    expect(agent.approvalRequired, `vector '${name}' has nothing gated`).toContain(gated.manifest);

    // Every adapter only reaches the gate when its peer asks for the tool, so
    // both stand-ins are told to ask before anything is started. The ACP stub
    // reads this at spawn time, which is inside createAgent — hence before.
    stub.reset();
    stub.callQueue = [{ tool: gated.wire, arguments: gated.args }];
    process.env.ACP_STUB_TOOL = gated.manifest;

    const runtime = await getRuntime(id);
    const handle = await runtime.createAgent(agent);
    const seen: ApprovalRequest[] = [];
    try {
      const result = await runtime.run(handle, "go ahead", ctx("deny", seen, []));
      expect(seen.map((r) => r.tool)).toContain(gated.manifest);
      // A denial is only meaningful if the tool did not run.
      expect(result.toolCalls).toBe(0);
    } finally {
      await handle.dispose();
    }
  });

  maybe("emits trace events when the manifest asks for an audit", async () => {
    const agent = await compiled("audit-on");
    expect(agent.audit).toBe(true);
    const runtime = await getRuntime(id);
    const handle = await runtime.createAgent(agent);
    const trace: TraceEvent[] = [];
    try {
      const result = await runtime.run(handle, "hello", ctx("deny", [], trace));
      expect(trace.length).toBeGreaterThan(0);
      expect(result.trace.length).toBeGreaterThan(0);
    } finally {
      await handle.dispose();
    }
  });

  maybe("stays quiet when the manifest does not ask for an audit", async () => {
    const agent = await compiled("audit-off");
    expect(agent.audit).toBe(false);
    const runtime = await getRuntime(id);
    const handle = await runtime.createAgent(agent);
    const trace: TraceEvent[] = [];
    try {
      await runtime.run(handle, "hello", ctx("allow", [], trace));
      expect(trace).toEqual([]);
    } finally {
      await handle.dispose();
    }
  });

});
