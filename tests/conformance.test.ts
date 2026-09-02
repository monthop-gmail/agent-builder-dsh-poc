import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";
import { getRuntime, listRuntimeIds, OFFLINE_RUNTIMES } from "../builder/registry/runtimes.js";
import type { ApprovalRequest, TraceEvent } from "../builder/types.js";

/**
 * The conformance suite every adapter must pass.
 *
 * Write the adapter against this, not the other way round. A runtime that
 * needs credentials is skipped rather than deleted from the list, so the
 * suite still documents what it owes.
 */

const fixture = (name: string) => resolve(import.meta.dirname, "../manifests", name);

async function compiled(name: string) {
  const loaded = await loadManifest(fixture(name));
  const result = validateManifest(loaded.value);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return compileManifest(loaded.value as AgentManifest, loaded.checksum).agent;
}

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
    expect(Array.isArray(runtime.unsupported(await compiled("coding-agent.yaml")))).toBe(true);
  });

  maybe("never receives a tool that policy forbade", async () => {
    const agent = await compiled("code-reviewer.yaml");
    const runtime = await getRuntime(id);
    const handle = await runtime.createAgent(agent);
    try {
      expect(agent.tools.map((t) => t.name)).not.toContain("github.merge");
    } finally {
      await handle.dispose();
    }
  });

  maybe("asks for approval before a gated tool, and honours a denial", async () => {
    const agent = await compiled("code-reviewer.yaml");
    const runtime = await getRuntime(id);
    const handle = await runtime.createAgent(agent);
    const seen: ApprovalRequest[] = [];
    const trace: TraceEvent[] = [];
    try {
      await runtime.run(handle, "review it", ctx("deny", seen, trace));
      expect(seen.map((r) => r.tool)).toContain("github.comment");
    } finally {
      await handle.dispose();
    }
  });

  maybe("emits trace events when the manifest asks for an audit", async () => {
    const agent = await compiled("code-reviewer.yaml");
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
    const agent = await compiled("researcher.yaml");
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

  maybe("cleans up without throwing", async () => {
    const runtime = await getRuntime(id);
    const handle = await runtime.createAgent(await compiled("researcher.yaml"));
    await expect(handle.dispose()).resolves.toBeUndefined();
  });
});
