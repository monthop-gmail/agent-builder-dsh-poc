import type { McpServerRef, ResolvedSkill, ResolvedTool } from "./types.js";
import { getTool } from "./registry/tools.js";
import { getSkill } from "./registry/skills.js";
import { getMcpServerRef } from "./registry/mcp.js";

/**
 * Resolver: names in a manifest are intent; here they become capabilities.
 * It resolves everything the manifest asked for — the Policy stage decides
 * what survives.
 */
export interface Resolution {
  tools: ResolvedTool[];
  skills: ResolvedSkill[];
  mcpServers: McpServerRef[];
}

export function resolveCapabilities(names: {
  tools?: string[];
  skills?: string[];
  mcp?: string[];
}): Resolution {
  return {
    tools: (names.tools ?? []).map(getTool),
    skills: (names.skills ?? []).map(getSkill),
    mcpServers: (names.mcp ?? []).map(getMcpServerRef),
  };
}
