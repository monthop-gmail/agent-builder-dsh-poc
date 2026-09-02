/**
 * Ask real MCP servers what they call their tools.
 *
 * Written to answer `agent-platform` #59, which asked whoever connects to MCP
 * for real to report what names actually come back rather than assume. Kept in
 * the repo because the answer changes as servers change, and the next person
 * to ask should be able to re-run it instead of trusting a table in an issue.
 *
 *   npx tsx probe-mcp.ts filesystem
 *   AI_COLLAB_MCP_TOKEN=... npx tsx probe-mcp.ts collaboration
 */
import { attachMcpServers } from "./runtimes/mcp-client.js";
import { getMcpServerRef } from "./builder/registry/mcp.js";
import { isToolId, isToolIdSegment, toolIdFor } from "./builder/tool-ids.js";
import type { CompiledAgent } from "./builder/types.js";

for (const name of process.argv.slice(2)) {
  const compiled = {
    mcpServers: [getMcpServerRef(name)],
    policy: { forbidden: [], humanApproval: [], deniedCapabilities: [] },
    autonomy: { level: 3, allowedEffects: ["read", "write", "irreversible"] },
  } as unknown as CompiledAgent;

  const attached = await attachMcpServers(compiled);
  const raw = attached.tools.map((t) => t.name.slice(name.length + 1));

  process.stderr.write(`\n=== ${name} · ${raw.length} tools ===\n`);
  for (const tool of raw) {
    const namespaced = `${name}.${tool}`;
    process.stderr.write(
      `${tool.padEnd(34)} bare=${isToolId(tool) ? "ok " : "NO "} ` +
        `seg=${isToolIdSegment(tool) ? "ok " : "NO "} ` +
        `ns=${isToolId(namespaced) ? "ok " : "NO "} ` +
        `→ ${toolIdFor(namespaced)}\n`,
    );
  }
  for (const connection of attached.connections) await connection.close();
}
process.exit(0);
