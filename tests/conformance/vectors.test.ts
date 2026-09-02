import { describe, expect, it } from "vitest";
import { compileVector, VECTORS } from "./vectors.js";

/**
 * Guards the vectors themselves.
 *
 * A fixture that stops exercising the thing its name claims does not fail —
 * it passes everywhere, for the wrong reason, and takes the coverage with
 * it quietly. So each vector declares what the Builder must produce from it,
 * and that declaration is checked before any runtime sees it.
 */

describe.each(VECTORS)("conformance vector — $name", (target) => {
  it(`isolates ${target.isolates}`, async () => {
    const { agent, droppedByPolicy } = await compileVector(target.name);
    const { expected } = target;

    expect(agent.autonomy.level).toBe(expected.autonomyLevel);
    expect(agent.tools.map((t) => t.name).toSorted()).toEqual(expected.tools);
    expect(agent.approvalRequired.toSorted()).toEqual(expected.approvalRequired);
    expect(droppedByPolicy.toSorted()).toEqual(expected.droppedByPolicy);
    expect(agent.modelFallbacks).toHaveLength(expected.modelFallbacks);
    expect(agent.mcpServers.map((m) => m.name).toSorted()).toEqual(expected.mcpServers);
    expect(agent.audit).toBe(expected.audit);
  });
});

describe("the vector set as a whole", () => {
  it("covers every autonomy level", async () => {
    const levels = new Set<number>();
    for (const target of VECTORS) levels.add((await compileVector(target.name)).agent.autonomy.level);
    expect([...levels].toSorted()).toEqual([0, 1, 2, 3]);
  });

  it("covers both sides of every switch a manifest can flip", async () => {
    const compiled = await Promise.all(VECTORS.map((v) => compileVector(v.name)));
    // A suite that only ever sees `audit: true` cannot notice a runtime that
    // traces unconditionally, so both sides have to be present.
    expect(compiled.some((c) => c.agent.audit)).toBe(true);
    expect(compiled.some((c) => !c.agent.audit)).toBe(true);
    expect(compiled.some((c) => c.agent.approvalRequired.length)).toBe(true);
    expect(compiled.some((c) => !c.agent.approvalRequired.length)).toBe(true);
    expect(compiled.some((c) => c.droppedByPolicy.length)).toBe(true);
    expect(compiled.some((c) => c.agent.mcpServers.length)).toBe(true);
    expect(compiled.some((c) => c.agent.modelFallbacks.length)).toBe(true);
    expect(compiled.some((c) => !c.agent.tools.length)).toBe(true);
  });
});
