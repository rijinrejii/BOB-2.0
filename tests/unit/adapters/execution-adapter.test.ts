/**
 * tests/unit/adapters/execution-adapter.test.ts
 *
 * Tests for the execution adapter.
 * Required: unavailable isolation remains unavailable.
 */
import { describe, it, expect } from "vitest";
import { UnavailableExecutionAdapter } from "../../../src/adapters/execution/unavailable-execution-adapter.js";

describe("UnavailableExecutionAdapter", () => {
  it("returns unavailable for any check request", async () => {
    const adapter = new UnavailableExecutionAdapter();
    const result = await adapter.requestCheck({
      runId: "run-1",
      commandId: "npm:test",
      commit: "a".repeat(40),
    });
    expect(result.outcome).toBe("unavailable");
    expect(result.failureKind).toBe("unavailable_execution");
  });

  it("never allows any check command", () => {
    const adapter = new UnavailableExecutionAdapter();
    expect(adapter.isCheckAllowed("npm:test")).toBe(false);
    expect(adapter.isCheckAllowed("any-command")).toBe(false);
    expect(adapter.isCheckAllowed("")).toBe(false);
  });

  it("returns null for getCheck (no checks were run)", async () => {
    const adapter = new UnavailableExecutionAdapter();
    expect(await adapter.getCheck("some-id")).toBeNull();
  });

  it("records the unavailable reason in output", () => {
    const adapter = new UnavailableExecutionAdapter();
    expect(adapter.unavailableReason).toContain("verified isolation boundary");
  });
});
