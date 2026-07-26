import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TaskStore } from "@fusion/core";
import { createTaskCreateTool, isAgentTaskCreateToolAvailable } from "../agent-tools.js";

/*
FNXC:EphemeralAgentTaskCreation 2026-07-26-06:20:
Operator report: with project policy "Ephemeral agent follow-up tasks = Deny", an executing agent
still filed ten follow-up tasks (five parallel fn_task_create calls it reported as timed out, then
five sequential retries). Deny must be structural — the tool is not registered for an ephemeral
session at all — not merely an execute-time refusal the model can keep retrying.

These tests assert the invariant on every surface that can hand fn_task_create to an ephemeral
worker: the shared registration predicate, the execute-time gate inside the factory (defense in
depth), and the two engine lanes that register the tool (outer execution session, per-step session).
*/

function settings(policy?: "allow" | "upon_validation" | "deny", legacy?: boolean) {
  return {
    ...(policy ? { ephemeralAgentTaskCreationPolicy: policy } : {}),
    ...(legacy === undefined ? {} : { ephemeralAgentsCanCreateTasks: legacy }),
  } as Parameters<typeof isAgentTaskCreateToolAvailable>[0];
}

function readEngineSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

describe("isAgentTaskCreateToolAvailable", () => {
  it("withholds the tool from an ephemeral caller when the policy denies creation", () => {
    expect(isAgentTaskCreateToolAvailable(settings("deny"), true)).toBe(false);
  });

  it("honors the legacy boolean when no explicit policy is persisted", () => {
    expect(isAgentTaskCreateToolAvailable(settings(undefined, false), true)).toBe(false);
    expect(isAgentTaskCreateToolAvailable(settings(undefined, true), true)).toBe(true);
  });

  it("keeps the tool for allow and upon_validation (a proposal is a supported action)", () => {
    expect(isAgentTaskCreateToolAvailable(settings("allow"), true)).toBe(true);
    expect(isAgentTaskCreateToolAvailable(settings("upon_validation"), true)).toBe(true);
  });

  it("never gates a non-ephemeral caller, even under deny", () => {
    expect(isAgentTaskCreateToolAvailable(settings("deny"), false)).toBe(true);
    expect(isAgentTaskCreateToolAvailable(settings("deny"), undefined)).toBe(true);
  });

  it("defaults to available when settings are unreadable", () => {
    expect(isAgentTaskCreateToolAvailable(undefined, true)).toBe(true);
    expect(isAgentTaskCreateToolAvailable(settings(), true)).toBe(true);
  });
});

describe("fn_task_create execute-time gate (defense in depth)", () => {
  it("refuses an ephemeral caller under deny without touching the store", async () => {
    let createCalls = 0;
    const store = {
      getSettings: async () => settings("deny"),
      createTask: async () => { createCalls += 1; throw new Error("createTask must not run under deny"); },
    } as unknown as TaskStore;

    const tool = createTaskCreateTool(store, { sourceType: "api" }, { callerIsEphemeral: true });
    const result = await (tool.execute as unknown as (
      id: string,
      params: unknown,
    ) => Promise<{ isError?: boolean; details?: unknown }>)(
      "call-1",
      { description: "Follow-up work discovered mid-task" },
    );

    expect(result.isError).toBe(true);
    expect((result.details as { rule?: string }).rule).toBe("ephemeral-agents-cannot-create-tasks");
    expect(createCalls).toBe(0);
  });
});

describe("engine lanes that register fn_task_create", () => {
  it("guards the outer execution session registration with the availability predicate", () => {
    const source = readEngineSource("executor.ts");
    expect(source).toContain("isAgentTaskCreateToolAvailable(settings, executionCallerIsEphemeral)");
  });

  it("guards the per-step workflow session registration with the availability predicate", () => {
    const source = readEngineSource("step-session-executor.ts");
    expect(source).toContain("isAgentTaskCreateToolAvailable(settings, this.options.callerIsEphemeral)");
  });
});
