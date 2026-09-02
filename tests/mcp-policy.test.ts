import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { validateManifest, type AgentManifest } from "../builder/validator.js";
import { compileManifest } from "../builder/compiler.js";
import { attachMcpServers, classifyEffect } from "../runtimes/mcp-client.js";
import { getMcpServerRef } from "../builder/registry/mcp.js";
import type { McpServerRef } from "../builder/types.js";

/**
 * MCP tools arrive after the Builder has finished, so they are the one place
 * a forbidden capability could slip past policy. These tests stand up a REAL
 * MCP server — the SDK's own, over Streamable HTTP — and prove it does not.
 *
 * The tool surface mirrors ai-collaboration-mcp so the assertions are about
 * a shape we actually ship a registry entry for.
 */

let http: Server;
let url: string;

function buildStubServer(): McpServer {
  const mcp = new McpServer({ name: "collab-stub", version: "0.1.0" });

  const reg = (name: string, description: string, shape: Record<string, z.ZodTypeAny> = {}) =>
    mcp.registerTool(
      name,
      { description, inputSchema: shape },
      async () => ({ content: [{ type: "text" as const, text: `${name} ok` }] }),
    );

  reg("get_workspace_context", "Catch up on the workspace", { limit: z.number().optional() });
  reg("get_discussion", "Read one discussion", { discussion_id: z.string() });
  reg("post_message", "Add a message to a discussion", {
    discussion_id: z.string(),
    body: z.string(),
  });
  reg("record_decision", "Record a proposed conclusion", { title: z.string(), detail: z.string() });
  reg("resolve_decision", "Approve or reject a decision", { decision_id: z.string() });

  return mcp;
}

beforeAll(async () => {
  // Streamable HTTP in stateless mode wants a fresh server and transport per
  // request; reusing one across requests 500s on the initialized notification.
  http = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const mcp = buildStubServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      try {
        await mcp.connect(transport);
        await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
      } catch {
        if (!res.headersSent) res.writeHead(500).end();
      }
    });
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;

  // Point the SHIPPED registry entry at the stub, so these tests exercise the
  // real descriptor — including its real toolEffects table — rather than a
  // copy of it that could drift.
  process.env.AI_COLLAB_MCP_URL = url;
  process.env.AI_COLLAB_MCP_TOKEN = "test-token";
});

afterAll(async () => {
  delete process.env.AI_COLLAB_MCP_URL;
  delete process.env.AI_COLLAB_MCP_TOKEN;
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

function agentFor(spec: Record<string, unknown>) {
  const candidate = {
    apiVersion: "agent/v1alpha2",
    kind: "Agent",
    metadata: { name: "mcp-fixture", version: "0.1.0" },
    spec: {
      purpose: { primary: "test" },
      model: { preferred: ["deepseek"] },
      autonomy: { level: 1 },
      ...spec,
    },
  };
  const result = validateManifest(candidate);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return compileManifest(candidate as AgentManifest, "z".repeat(64)).agent;
}

describe("classifyEffect", () => {
  const bare: McpServerRef = { name: "x", transport: "http", url: "http://x" };

  it("uses the server's declared effect when there is one", () => {
    const ref = getMcpServerRef("collaboration");
    expect(classifyEffect("resolve_decision", ref)).toBe("irreversible");
    expect(classifyEffect("get_workspace_context", ref)).toBe("read");
  });

  it("falls back to a name heuristic for read-shaped names", () => {
    for (const n of ["get_tasks", "list_items", "search_docs", "read_file"]) {
      expect(classifyEffect(n, bare)).toBe("read");
    }
  });

  it("defaults an unknown name to write rather than read", () => {
    for (const n of ["post_message", "frobnicate", "sync"]) {
      expect(classifyEffect(n, bare)).toBe("write");
    }
  });
});

describe("Policy reaches tools discovered at connect time", () => {
  it("discovers the server's tools and namespaces them", async () => {
    const agent = agentFor({ mcp: { servers: ["collaboration"] } });
    const mcp = await attachMcpServers(agent);
    try {
      expect(mcp.tools.map((t) => t.name).sort()).toEqual([
        "collaboration.get_discussion",
        "collaboration.get_workspace_context",
        "collaboration.post_message",
        "collaboration.record_decision",
        "collaboration.resolve_decision",
      ]);
    } finally {
      await Promise.all(mcp.connections.map((c) => c.close()));
    }
  });

  it("withholds a forbidden MCP tool entirely — it is never reachable", async () => {
    const agent = agentFor({
      mcp: { servers: ["collaboration"] },
      policy: { forbidden: ["collaboration.resolve_decision"] },
    });
    const mcp = await attachMcpServers(agent);
    try {
      expect(mcp.tools.map((t) => t.name)).not.toContain("collaboration.resolve_decision");
      expect(mcp.withheld).toEqual(["collaboration.resolve_decision"]);
    } finally {
      await Promise.all(mcp.connections.map((c) => c.close()));
    }
  });

  it("lets a read-only agent use read tools but gates the writing ones", async () => {
    const agent = agentFor({ autonomy: { level: 1 }, mcp: { servers: ["collaboration"] } });
    const mcp = await attachMcpServers(agent);
    try {
      // read tools are free at level 1 …
      expect(mcp.approvalRequired).not.toContain("collaboration.get_workspace_context");
      expect(mcp.approvalRequired).not.toContain("collaboration.get_discussion");
      // … everything that writes to the shared table is not
      expect(mcp.approvalRequired).toContain("collaboration.post_message");
      expect(mcp.approvalRequired).toContain("collaboration.record_decision");
    } finally {
      await Promise.all(mcp.connections.map((c) => c.close()));
    }
  });

  it("honours humanApproval even when the autonomy level would allow it", async () => {
    const agent = agentFor({
      autonomy: { level: 3 },
      mcp: { servers: ["collaboration"] },
      humanApproval: { required: ["collaboration.post_message"] },
    });
    const mcp = await attachMcpServers(agent);
    try {
      expect(mcp.approvalRequired).toEqual(["collaboration.post_message"]);
    } finally {
      await Promise.all(mcp.connections.map((c) => c.close()));
    }
  });

  it("actually calls through to the server", async () => {
    const agent = agentFor({ mcp: { servers: ["collaboration"] } });
    const mcp = await attachMcpServers(agent);
    try {
      const tool = mcp.tools.find((t) => t.name === "collaboration.get_workspace_context");
      const result = await tool?.execute({});
      expect(result?.text).toBe("get_workspace_context ok");
    } finally {
      await Promise.all(mcp.connections.map((c) => c.close()));
    }
  });
});
