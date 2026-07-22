import { describe, expect, it } from "vitest";
import { createMergeGateHandler } from "../workflow-node-runners/merge-runner.js";

describe("createMergeGateHandler FUS-010", () => {
  const gate = createMergeGateHandler();

  async function run(task: { autoMerge?: boolean }, settings?: { autoMerge?: boolean }) {
    return gate(
      { id: "merge-gate", type: "merge-gate" } as never,
      { task, settings, context: {}, signal: new AbortController().signal } as never,
    );
  }

  it("task false + project true => auto-off", async () => {
    expect(await run({ autoMerge: false }, { autoMerge: true })).toEqual({
      outcome: "success",
      value: "auto-off",
    });
  });

  it("task true + project false => auto-on (per-task opt-in)", async () => {
    expect(await run({ autoMerge: true }, { autoMerge: false })).toEqual({
      outcome: "success",
      value: "auto-on",
    });
  });

  it("task undefined + project true => auto-on", async () => {
    expect(await run({}, { autoMerge: true })).toEqual({
      outcome: "success",
      value: "auto-on",
    });
  });

  it("task undefined + project false => auto-off", async () => {
    expect(await run({}, { autoMerge: false })).toEqual({
      outcome: "success",
      value: "auto-off",
    });
  });

  it("task undefined + settings missing fails closed to auto-off (callers must materialize schema defaults)", async () => {
    expect(await run({}, undefined)).toEqual({
      outcome: "success",
      value: "auto-off",
    });
  });

  it("does not coerce project undefined via === true into a false that hides inheritance", async () => {
    // Pass-through undefined: without a global slice the resolver fails closed.
    // Distinct from the prior bug that forced `{ autoMerge: false }` whenever
    // settings.autoMerge was not strictly true.
    expect(await run({}, { autoMerge: undefined })).toEqual({
      outcome: "success",
      value: "auto-off",
    });
  });
});
