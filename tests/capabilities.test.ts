import { describe, expect, it } from "vitest";
import { classifyGaps, listGapNames, refusesRun } from "../builder/registry/capabilities.js";

/**
 * The rule this file guards: a gap that removes a RESTRICTION blocks the run,
 * a gap that removes a CAPABILITY only warns.
 *
 * It matters because the two look identical in `unsupported()` — both are
 * just strings an adapter returns — and the difference is whether an operator
 * still has the guarantee their manifest states.
 */

describe("capability gap severity", () => {
  it("blocks when a restriction cannot be honoured", () => {
    const report = classifyGaps(["policy.forbidden"]);
    expect(report.blocking.map((g) => g.name)).toEqual(["policy.forbidden"]);
    expect(refusesRun(report)).toBe(true);
  });

  it("only warns when a capability is missing", () => {
    const report = classifyGaps(["tools.local", "mcp.connect", "model.fallback"]);
    expect(report.blocking).toEqual([]);
    expect(report.degrading).toHaveLength(3);
    expect(refusesRun(report)).toBe(false);
  });

  it("treats an unclassified name as blocking", () => {
    // Otherwise an adapter could downgrade its own severity by inventing a
    // name nobody has reviewed.
    const report = classifyGaps(["something.new"]);
    expect(report.unknown).toEqual(["something.new"]);
    expect(refusesRun(report)).toBe(true);
  });

  it("lets one blocking gap outweigh any number of warnings", () => {
    const report = classifyGaps(["mcp.connect", "policy.forbidden", "trace.model_step"]);
    expect(report.degrading).toHaveLength(2);
    expect(refusesRun(report)).toBe(true);
  });

  it("runs clean when there is nothing to report", () => {
    const report = classifyGaps([]);
    expect(refusesRun(report)).toBe(false);
  });

  it("classifies both policy fields, since either one is a guarantee", () => {
    for (const name of ["policy.forbidden", "policy.humanApproval"]) {
      expect(classifyGaps([name]).blocking).toHaveLength(1);
    }
    expect(listGapNames()).toContain("policy.humanApproval");
  });
});
