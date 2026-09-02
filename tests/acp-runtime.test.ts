import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadManifest } from "../builder/loader.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";
import { AcpRuntime, childEnv } from "../runtimes/acp/adapter.js";
import { RunAborted } from "../builder/errors.js";
import { compileVector } from "./conformance/vectors.js";
import type { ApprovalRequest, TraceEvent } from "../builder/types.js";

/**
 * The ACP adapter against a stub agent that persists its sessions to disk.
 *
 * Persistence matters: `resume` spawns a fresh agent process, so a session
 * held only in memory would not survive the test — which is the same reason
 * it would not survive in production.
 */

const stub = resolve(import.meta.dirname, "support/acp-stub-agent.mjs");
let state: string;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-builder-acp-"));
  state = join(dir, "sessions.json");
  process.env.ACP_AGENT_COMMAND = process.execPath;
  process.env.ACP_AGENT_ARGS = stub;
  process.env.ACP_STUB_STATE = state;
});

afterAll(async () => {
  for (const key of ["ACP_AGENT_COMMAND", "ACP_AGENT_ARGS", "ACP_STUB_STATE"]) delete process.env[key];
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  for (const key of ["ACP_STUB_TEXT", "ACP_STUB_TOOL", "ACP_STUB_FAIL"]) delete process.env[key];
});

async function compiled(name: string, dirName = "../manifests") {
  const loaded = await loadManifest(resolve(import.meta.dirname, dirName, name));
  const result = validateManifest(loaded.value);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return compileManifest(loaded.value as AgentManifest, loaded.checksum).agent;
}

const ctx = (decision: "allow" | "deny", seen: ApprovalRequest[] = [], trace: TraceEvent[] = []) => ({
  async requestApproval(req: ApprovalRequest) {
    seen.push(req);
    return decision;
  },
  onTrace(event: TraceEvent) {
    trace.push(event);
  },
});

describe("AcpRuntime", () => {
  it("opens a session, prompts it, and collects the reply", async () => {
    process.env.ACP_STUB_TEXT = "hello over ACP";
    const agent = await compiled("researcher.yaml");
    const runtime = new AcpRuntime();
    const handle = await runtime.createAgent(agent);
    try {
      expect(handle.sessionId).toMatch(/^stub-session-/);
      const result = await runtime.run(handle, "hi", ctx("deny"));
      expect(result.output).toBe("hello over ACP");
    } finally {
      await handle.dispose();
    }
  });

  it("resumes a session in a new agent process", async () => {
    const agent = await compiled("researcher.yaml");
    const runtime = new AcpRuntime();

    const first = await runtime.createAgent(agent);
    const sessionId = first.sessionId as string;
    await first.dispose();

    // Fresh process, no shared memory — only the session id and the manifest.
    process.env.ACP_STUB_TEXT = "resumed";
    const second = await runtime.resume(agent, sessionId);
    try {
      expect(second.sessionId).toBe(sessionId);
      const result = await runtime.run(second, "carry on", ctx("deny"));
      expect(result.output).toBe("resumed");
    } finally {
      await second.dispose();
    }
  });

  it("refuses to resume a session the agent does not have", async () => {
    const agent = await compiled("researcher.yaml");
    await expect(new AcpRuntime().resume(agent, "stub-session-does-not-exist")).rejects.toThrow(
      /no such session/,
    );
  });

  it("answers the agent's permission request from the manifest's policy", async () => {
    process.env.ACP_STUB_TOOL = "write_file";
    const agent = await compiled("code-reviewer.yaml");
    const runtime = new AcpRuntime();
    const handle = await runtime.createAgent(agent);
    const seen: ApprovalRequest[] = [];
    const trace: TraceEvent[] = [];
    try {
      const result = await runtime.run(handle, "do it", ctx("deny", seen, trace));
      expect(seen.map((r) => r.tool)).toEqual(["write_file"]);
      // A tool the manifest never granted is unknown to the Builder, so it is
      // treated as a write rather than assumed harmless.
      expect(seen[0]?.effect).toBe("write");
      expect(result.output).toBe("write_file refused");
      expect(result.toolCalls).toBe(0);
      expect(trace.map((e) => e.kind)).toContain("approval");
    } finally {
      await handle.dispose();
    }
  });

  it("lets the tool run when approval is granted", async () => {
    process.env.ACP_STUB_TOOL = "write_file";
    const agent = await compiled("code-reviewer.yaml");
    const runtime = new AcpRuntime();
    const handle = await runtime.createAgent(agent);
    try {
      const result = await runtime.run(handle, "do it", ctx("allow"));
      expect(result.output).toBe("write_file ran");
      expect(result.toolCalls).toBe(1);
    } finally {
      await handle.dispose();
    }
  });

  it("declares that it cannot carry local tools or enforce forbidden", async () => {
    const runtime = new AcpRuntime();
    // code-reviewer grants github.* and forbids github.merge: both are things
    // an out-of-process agent will not honour, so both are declared.
    expect(runtime.unsupported(await compiled("code-reviewer.yaml")).toSorted()).toEqual([
      "policy.forbidden",
      "tools.local",
    ]);
    // A manifest with neither is fully supported. The shared `minimal`
    // vector already is that manifest, so this does not keep a second copy.
    expect(runtime.unsupported((await compileVector("minimal")).agent)).toEqual([]);
  });

  it("reports what already happened when the agent fails mid-run", async () => {
    process.env.ACP_STUB_FAIL = "session/prompt";
    const agent = await compiled("researcher.yaml");
    const runtime = new AcpRuntime();
    const handle = await runtime.createAgent(agent);
    try {
      const failure = await runtime
        .run(handle, "hi", ctx("deny"))
        .then(() => undefined, (error: unknown) => error);
      expect(failure).toBeInstanceOf(RunAborted);
      expect((failure as RunAborted).result.trace.map((e) => e.kind)).toContain("error");
    } finally {
      await handle.dispose();
    }
  });

  it("drops the variables the operator named from the agent's environment", () => {
    // Observed against @zed-industries/claude-code-acp: it refuses to start
    // when CLAUDECODE is set, because that means it is being launched from
    // inside another Claude Code session. The variable had nothing to do with
    // this adapter — it was simply inherited.
    process.env.ACP_CHILD_ENV_PROBE = "present";
    process.env.ACP_AGENT_ENV_UNSET = "ACP_CHILD_ENV_PROBE";
    try {
      expect(childEnv().ACP_CHILD_ENV_PROBE).toBeUndefined();
      // The rest of the environment still has to reach the agent.
      expect(childEnv().PATH).toBe(process.env.PATH);
    } finally {
      delete process.env.ACP_CHILD_ENV_PROBE;
      delete process.env.ACP_AGENT_ENV_UNSET;
    }
  });

  it("passes the environment through untouched when nothing is named", () => {
    // Scrubbing by default would break targets that need what it removed, for
    // a reason nobody could find.
    expect(childEnv()).toBe(process.env);
  });

  it("says which variable names the agent when it is not configured", async () => {
    const saved = process.env.ACP_AGENT_COMMAND;
    delete process.env.ACP_AGENT_COMMAND;
    try {
      await expect(new AcpRuntime().createAgent(await compiled("researcher.yaml"))).rejects.toThrow(
        /ACP_AGENT_COMMAND/,
      );
    } finally {
      process.env.ACP_AGENT_COMMAND = saved;
    }
  });
});
