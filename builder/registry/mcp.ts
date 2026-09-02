import path from "node:path";
import { createRequire } from "node:module";
import type { McpServerRef } from "../types.js";

/**
 * MCP Registry — manifest MCP name -> connection descriptor.
 * Secrets come from the environment, never from a manifest.
 */

const require = createRequire(import.meta.url);

interface Descriptor {
  name: string;
  buildRef(): McpServerRef;
}

function filesystemCommand(): { command: string; args: string[] } {
  const root = process.env.AGENT_BUILDER_FS_ROOT ?? process.cwd();
  try {
    const pkgPath = require.resolve("@modelcontextprotocol/server-filesystem/package.json");
    const pkg = require(pkgPath) as { bin?: string | Record<string, string>; main?: string };
    const dir = path.dirname(pkgPath);
    const entry =
      typeof pkg.bin === "string"
        ? path.join(dir, pkg.bin)
        : pkg.bin && Object.values(pkg.bin)[0]
          ? path.join(dir, Object.values(pkg.bin)[0] as string)
          : path.join(dir, pkg.main ?? "dist/index.js");
    return { command: process.execPath, args: [entry, root] };
  } catch {
    return { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", root] };
  }
}

const SERVERS: Record<string, Descriptor> = {
  filesystem: {
    name: "filesystem",
    buildRef() {
      const { command, args } = filesystemCommand();
      return { name: "filesystem", transport: "stdio", command, args };
    },
  },
  collaboration: {
    name: "collaboration",
    buildRef() {
      const url =
        process.env.AI_COLLAB_MCP_URL ??
        "https://ai-collaboration-mcp.monthop-gmail.workers.dev/mcp";
      const token = process.env.AI_COLLAB_MCP_TOKEN;
      if (!token) {
        throw new Error("MCP 'collaboration' requires AI_COLLAB_MCP_TOKEN in the environment");
      }
      return {
        name: "collaboration",
        transport: "http",
        url,
        headers: { Authorization: `Bearer ${token}` },
        // Taken from the server's live tool list, not guessed. Without this
        // the name heuristic would still get the get_* tools right, but
        // resolve_decision would be classed "write" when it actually settles
        // a governance decision — that one deserves the top tier.
        toolEffects: {
          get_workspace_context: "read",
          get_discussion: "read",
          get_tasks: "read",
          get_decisions: "read",
          get_plans: "read",
          get_handoffs: "read",
          create_discussion: "write",
          post_message: "write",
          create_task: "write",
          update_task: "write",
          record_plan: "write",
          record_decision: "write",
          create_handoff: "write",
          accept_handoff: "write",
          resolve_decision: "irreversible",
        },
      };
    },
  },
};

export function listMcpServerNames(): string[] {
  return Object.keys(SERVERS).sort();
}
export function hasMcpServer(name: string): boolean {
  return Object.hasOwn(SERVERS, name);
}
export function getMcpServerRef(name: string): McpServerRef {
  const s = SERVERS[name];
  if (!s) throw new Error(`MCP server not found in registry: '${name}'`);
  return s.buildRef();
}
