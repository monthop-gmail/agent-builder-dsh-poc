import type { McpServerRef, ResolvedTool } from "../builder/types.js";

/**
 * Shared MCP plumbing. An MCP server's tools become ordinary ResolvedTools so
 * that everything downstream — policy, approval, tracing — treats them
 * exactly like local tools. There is no second code path for MCP.
 */

export interface McpConnection {
  ref: McpServerRef;
  tools: ResolvedTool[];
  close(): Promise<void>;
}

interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export async function connectMcpServers(refs: McpServerRef[]): Promise<McpConnection[]> {
  const connections: McpConnection[] = [];
  for (const ref of refs) {
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

    const tools: ResolvedTool[] = (listed.tools ?? []).map((t) => ({
      name: `${ref.name}.${t.name}`,
      description: t.description ?? `Tool '${t.name}' from MCP server '${ref.name}'`,
      // An MCP server's tools are external code: assume they can write until
      // the server tells us otherwise. Under-privileging is recoverable;
      // over-privileging is not.
      effect: "write",
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
    }));

    connections.push({
      ref,
      tools,
      close: async () => {
        await client.close().catch(() => {});
      },
    });
  }
  return connections;
}
