import type { ResolvedSkill } from "../types.js";

/**
 * Skill Registry — reusable behaviour as instruction text. Skills carry no
 * executable code; that is the Tool Registry's job. The Compiler folds these
 * into the system prompt.
 */

const SKILLS: Record<string, ResolvedSkill> = {
  research: {
    name: "research",
    description: "Systematic web research behaviour.",
    instructions: [
      "## Skill: research",
      "- Break the question into sub-questions before searching.",
      "- Prefer primary sources; note the source URL for every claim.",
      "- State clearly when information could not be verified.",
    ].join("\n"),
  },
  "code-review": {
    name: "code-review",
    description: "Reviewing a change for correctness and clarity.",
    instructions: [
      "## Skill: code-review",
      "- Read the whole diff before commenting on any part of it.",
      "- Report a finding only with a concrete failure scenario: inputs, then wrong result.",
      "- Separate correctness bugs from style preferences, and say which is which.",
      "- Quote file and line for every finding.",
    ].join("\n"),
  },
  "security-review": {
    name: "security-review",
    description: "Looking for security defects in a change.",
    instructions: [
      "## Skill: security-review",
      "- Check untrusted input paths first: request bodies, file names, env, tool results.",
      "- Name the vulnerability class (injection, SSRF, path traversal, secret exposure).",
      "- Prefer the safer fix when two fixes both work.",
      "- Never include a real secret value in your output.",
    ].join("\n"),
  },
  coder: {
    name: "coder",
    description: "Disciplined coding behaviour.",
    instructions: [
      "## Skill: coder",
      "- State assumptions before writing code.",
      "- Prefer the smallest change that satisfies the requirement.",
      "- Always include how to run and verify the change.",
    ].join("\n"),
  },
};

export function listSkillNames(): string[] {
  return Object.keys(SKILLS).sort();
}
export function hasSkill(name: string): boolean {
  return Object.hasOwn(SKILLS, name);
}
export function getSkill(name: string): ResolvedSkill {
  const skill = SKILLS[name];
  if (!skill) throw new Error(`Skill not found in registry: '${name}'`);
  return skill;
}
