import type { ResolvedTool } from "../types.js";

/**
 * Tool Registry — manifest tool name -> executable capability.
 *
 * Every tool declares an `effect`. That is not documentation: the Compiler
 * uses it to enforce `spec.autonomy.level`, and the runtime uses it to decide
 * what needs a human. A tool with the wrong effect is a security bug.
 *
 * Production would merge registries published by L5 repos instead of this map.
 */

function jsonSchema(props: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties: props, required, additionalProperties: false };
}

const calculator: ResolvedTool = {
  name: "calculator",
  effect: "read",
  description: "Evaluate a pure arithmetic expression (digits, + - * / % ** and parentheses).",
  parameters: jsonSchema(
    { expression: { type: "string", description: "e.g. (2 + 3) * 7" } },
    ["expression"],
  ),
  async execute(args) {
    const expr = String(args.expression ?? "");
    if (!/^[0-9+\-*/%().\s]+$/.test(expr.replace(/\*\*/g, ""))) {
      throw new Error(`calculator: disallowed characters in '${expr}'`);
    }
    const value = Function(`"use strict"; return (${expr});`)() as unknown;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`calculator: '${expr}' did not evaluate to a finite number`);
    }
    return { text: `${expr} = ${value}` };
  },
};

const currentTime: ResolvedTool = {
  name: "current_time",
  effect: "read",
  description: "Return the current UTC time in ISO 8601 format.",
  parameters: jsonSchema({}),
  async execute() {
    return { text: new Date().toISOString() };
  },
};

const webSearch: ResolvedTool = {
  name: "web_search",
  effect: "read",
  description: "Search the web (DuckDuckGo Instant Answer API) and return a short summary.",
  parameters: jsonSchema({ query: { type: "string", description: "Search query" } }, ["query"]),
  async execute(args) {
    const query = String(args.query ?? "");
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error(`web_search: HTTP ${res.status}`);
    const data = (await res.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      RelatedTopics?: { Text?: string }[];
    };
    const lines: string[] = [];
    if (data.AbstractText) lines.push(`${data.AbstractText} (${data.AbstractURL ?? ""})`);
    for (const t of (data.RelatedTopics ?? []).slice(0, 5)) if (t.Text) lines.push(`- ${t.Text}`);
    return { text: lines.length ? lines.join("\n") : `No results for '${query}'.` };
  },
};

/* ---------- GitHub: the P6 (Issue -> PR) surface ---------- */

async function gh(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set in the environment");
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`github: HTTP ${res.status} on ${path} — ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : {};
}

const githubRead: ResolvedTool = {
  name: "github.read",
  effect: "read",
  description: "Read a GitHub issue or pull request, including its body and comments.",
  parameters: jsonSchema(
    {
      repo: { type: "string", description: "owner/repo" },
      number: { type: "integer", description: "Issue or PR number" },
    },
    ["repo", "number"],
  ),
  async execute(args) {
    const repo = String(args.repo ?? "");
    const num = Number(args.number);
    const issue = (await gh(`/repos/${repo}/issues/${num}`)) as {
      title?: string;
      body?: string;
      state?: string;
    };
    const comments = (await gh(`/repos/${repo}/issues/${num}/comments?per_page=20`)) as {
      user?: { login?: string };
      body?: string;
    }[];
    const parts = [
      `#${num} [${issue.state ?? "?"}] ${issue.title ?? ""}`,
      issue.body ?? "(no body)",
      ...comments.map((c) => `--- @${c.user?.login ?? "?"}\n${c.body ?? ""}`),
    ];
    return { text: parts.join("\n\n") };
  },
};

const githubComment: ResolvedTool = {
  name: "github.comment",
  effect: "write",
  description: "Post a comment on a GitHub issue or pull request.",
  parameters: jsonSchema(
    {
      repo: { type: "string", description: "owner/repo" },
      number: { type: "integer" },
      body: { type: "string", description: "Comment body, markdown" },
    },
    ["repo", "number", "body"],
  ),
  async execute(args) {
    const repo = String(args.repo ?? "");
    const num = Number(args.number);
    const created = (await gh(`/repos/${repo}/issues/${num}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: String(args.body ?? "") }),
    })) as { html_url?: string };
    return { text: `commented: ${created.html_url ?? "(ok)"}` };
  },
};

const githubMerge: ResolvedTool = {
  name: "github.merge",
  effect: "irreversible",
  description: "Merge a pull request.",
  parameters: jsonSchema(
    { repo: { type: "string" }, number: { type: "integer" } },
    ["repo", "number"],
  ),
  async execute(args) {
    const merged = (await gh(`/repos/${String(args.repo)}/pulls/${Number(args.number)}/merge`, {
      method: "PUT",
    })) as { sha?: string };
    return { text: `merged: ${merged.sha ?? "(ok)"}` };
  },
};

const TOOLS: Record<string, ResolvedTool> = {
  calculator,
  current_time: currentTime,
  web_search: webSearch,
  "github.read": githubRead,
  "github.comment": githubComment,
  "github.merge": githubMerge,
};

export function listToolNames(): string[] {
  return Object.keys(TOOLS).sort();
}
export function hasTool(name: string): boolean {
  return Object.hasOwn(TOOLS, name);
}
export function getTool(name: string): ResolvedTool {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Tool not found in registry: '${name}'`);
  return tool;
}
