import type { CompiledAgent, McpServerRef, ResolvedTool, ToolEffect } from "../builder/types.js";
import { admitLateTools } from "../builder/registry/policy.js";

/**
 * Shared MCP plumbing — and the ONLY place any adapter obtains MCP tools.
 *
 * That matters: an MCP server does not announce its tools until a client
 * connects, so those tools miss the Builder's policy pass. Routing every
 * adapter through this function means they get the same pass here instead of
 * arriving ungoverned. An adapter cannot forget, because it never builds MCP
 * tools itself.
 */

export interface McpAttachment {
  connections: McpConnection[];
  /** Discovered tools that survived policy. Hand these to the model. */
  tools: ResolvedTool[];
  /** Discovered tool names that need a human on every call. */
  approvalRequired: string[];
  /** Discovered tool names policy withheld. Reported so the CLI can say so. */
  withheld: string[];
}

export interface McpConnection {
  ref: McpServerRef;
  close(): Promise<void>;
}

interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP carries no notion of whether a tool mutates state, so we infer it:
 * an explicit entry in the server's descriptor wins, then a conservative name
 * heuristic, then "write". Guessing "read" wrongly would hand a mutating tool
 * to a read-only agent, so "write" is the default rather than the fallback of
 * last resort.
 */
const READ_PREFIX = /^(get|list|read|search|fetch|find|query|describe|show|view)[_.-]/i;

export function classifyEffect(toolName: string, ref: McpServerRef): ToolEffect {
  const explicit = ref.toolEffects?.[toolName];
  if (explicit) return explicit;
  return READ_PREFIX.test(toolName) ? "read" : "write";
}

export async function attachMcpServers(compiled: CompiledAgent): Promise<McpAttachment> {
  const connections: McpConnection[] = [];
  const discovered: ResolvedTool[] = [];

  for (const ref of compiled.mcpServers) {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

    let transport: unknown;
    if (ref.transport === "http") {
      const { StreamableHTTPClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/streamableHttp.js"
      );
      transport = new StreamableHTTPClientTransport(new URL(ref.url as string), {
        requestInit: { headers: ref.headers ?? {} },
      });
    } else {
      const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
      transport = new StdioClientTransport({
        command: ref.command as string,
        args: ref.args ?? [],
      });
    }

    const client = new Client({ name: "agent-builder-dsh-poc", version: "0.1.0" });
    await client.connect(transport as never);
    const listed = (await client.listTools()) as { tools?: McpToolDescriptor[] };

    for (const t of listed.tools ?? []) {
      discovered.push({
        // Namespaced so a manifest can forbid one server's tool without
        // touching another's tool of the same name.
        name: `${ref.name}.${t.name}`,
        description: t.description ?? `Tool '${t.name}' from MCP server '${ref.name}'`,
        effect: classifyEffect(t.name, ref),
        // Everything reached through MCP needs `mcp`, whatever it does once
        // it gets there. A profile that denies `mcp` withholds the lot, which
        // is the point of a capability ceiling: it works on tools whose names
        // nobody could have known in advance.
        capabilities: ["mcp"],
        parameters: t.inputSchema,
        async execute(args) {
          const result = (await client.callTool({ name: t.name, arguments: args })) as {
            content?: { type: string; text?: string }[];
          };
          const text = (result.content ?? [])
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join("\n");
          return { text: text || "(empty MCP tool result)" };
        },
      });
    }

    connections.push({
      ref,
      close: async () => {
        await client.close().catch(() => {});
      },
    });
  }

  const decision = admitLateTools(compiled, discovered);
  return {
    connections,
    tools: decision.granted,
    approvalRequired: decision.approvalRequired,
    withheld: decision.forbidden,
  };
}
