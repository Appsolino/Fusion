// @vitest-environment node
/**
 * FUS-029: Retry on a failed in-review merge with task.autoMerge=false must not
 * re-arm automatic merge. Parks as awaiting-user-review and leaves the PR open.
 */
import { describe, expect, it, vi } from "vitest";
import express from "express";
import type { Task, TaskStore } from "@fusion/core";
import { allowsAutoMergeProcessing, resolveEffectiveAutoMerge } from "@fusion/core";
import { registerTaskWorkflowRoutes } from "../routes/register-task-workflow-routes.js";
import { request as performRequest } from "../test-request.js";
import { ApiError, sendErrorResponse } from "../api-error.js";

/** APP-002-shaped fixture — disposable; does not touch live production APP-002. */
function mkApp002Fixture(overrides: Partial<Task> = {}): Task {
  return {
    id: "APP-002-FIXTURE",
    title: "Fix flaky WorkItem CAS concurrency validation",
    description: "d",
    column: "in-review",
    status: "failed",
    error: "Pull request cannot be merged due to conflicts.",
    autoMerge: false,
    autoMergeProvenance: "user",
    mergeRetries: 1,
    dependencies: [],
    createdAt: "2026-07-22T10:19:09.617Z",
    updatedAt: "2026-07-22T11:52:08.860Z",
    size: "S",
    subtasks: [],
    log: [],
    tags: [],
    blockedBy: [],
    steps: [
      { name: "Preflight", status: "done" },
      { name: "Tighten", status: "done" },
      { name: "Verify", status: "done" },
      { name: "Testing", status: "done" },
      { name: "Docs", status: "done" },
    ],
    prInfo: {
      url: "https://github.com/Appsolino/autopilot-app/pull/19",
      number: 19,
      status: "open",
      title: "APP-002: Fix flaky WorkItem CAS concurrency validation",
      headBranch: "fusion/app-002",
      baseBranch: "main",
      commentCount: 0,
      mergeable: "blocked",
    },
    source: { sourceType: "api" },
    ...overrides,
  } as unknown as Task;
}

function buildApp(input: {
  task: Task;
  settings?: { autoMerge: boolean };
  enqueueMerge?: ReturnType<typeof vi.fn>;
}) {
  let current = { ...input.task };
  const updateTask = vi.fn(async (_id: string, patch: Partial<Task>) => {
    current = { ...current, ...patch };
    return current;
  });
  const moveTask = vi.fn(async () => current);
  const logEntry = vi.fn(async () => {});
  const enqueueMerge = input.enqueueMerge ?? vi.fn();
  const store = {
    getTask: async () => current,
    getTaskDetail: async () => current,
    updateTask,
    moveTask,
    logEntry,
    getSettings: async () => input.settings ?? { autoMerge: true },
    getSettingsFast: async () => input.settings ?? { autoMerge: true },
    getRootDir: () => "/tmp/does-not-exist",
    listTasks: async () => [current],
  } as unknown as TaskStore;

  const runtimeLogger = { warn: vi.fn(), error: vi.fn(), log: vi.fn() };
  const router = express.Router();
  registerTaskWorkflowRoutes({
    router,
    store,
    options: {},
    runtimeLogger: runtimeLogger as never,
    planningLogger: runtimeLogger as never,
    chatLogger: runtimeLogger as never,
    getProjectIdFromRequest: () => undefined,
    getScopedStore: async () => store,
    getProjectContext: async () => ({
      store,
      engine: { enqueueMerge, clearTaskPauseAbortState: vi.fn() } as never,
      projectId: "proj_fixture",
    }),
    prioritizeProjectsForCurrentDirectory: (projects: unknown) => projects,
    emitRemoteRouteDiagnostic: () => {},
    emitAuthSyncAuditLog: () => {},
    parseScopeParam: () => undefined,
    resolveAutomationStore: () => ({}) as never,
    resolveRoutineStore: () => ({}) as never,
    resolveRoutineRunner: () => ({}) as never,
    registerDispose: () => {},
    dispose: () => {},
    rethrowAsApiError: (error: unknown): never => {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, error instanceof Error ? error.message : "Internal server error");
    },
  } as never, {
    runtimeLogger,
    upload: { single: () => (_req: unknown, _res: unknown, next: () => void) => next() },
    taskDetailActivityLogLimit: 100,
    validateOptionalModelField: (value: unknown) => (typeof value === "string" ? value : undefined),
    normalizeModelSelectionPair: (provider: string | null, modelId: string | null) => ({
      provider: provider ?? null,
      modelId: modelId ?? null,
    }),
    runGitCommand: async () => "",
    isGitRepo: async () => true,
    resolveIntegrationBranch: async () => "main",
    trimTaskDetailActivityLog: (task: unknown) => task,
    triggerCommentWakeForAssignedAgent: async () => {},
    resolveSelfHealingManager: () => undefined,
  } as never);

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ApiError) {
      sendErrorResponse(res, error.statusCode, error.message, { details: error.details });
      return;
    }
    sendErrorResponse(res, 500, error instanceof Error ? error.message : "Internal server error");
  });
  return { app, updateTask, logEntry, enqueueMerge, getTask: () => current };
}

describe("FUS-029 Retry with autoMerge=false", () => {
  it("APP-002 fixture: allowsAutoMergeProcessing is false when project autoMerge is true", () => {
    const task = mkApp002Fixture();
    expect(resolveEffectiveAutoMerge(task, { autoMerge: true })).toBe(false);
    expect(allowsAutoMergeProcessing(task, { autoMerge: true })).toBe(false);
  });

  it("Retry clears failed into awaiting-user-review without enqueueing merge", async () => {
    const { app, updateTask, logEntry, enqueueMerge, getTask } = buildApp({
      task: mkApp002Fixture(),
      settings: { autoMerge: true },
    });

    const res = await performRequest(app, "POST", "/api/tasks/APP-002-FIXTURE/retry", "{}", {
      "content-type": "application/json",
    });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.status).toBe("awaiting-user-review");
    expect(body.error).toBeNull();
    expect(body.autoMerge).toBe(false);
    expect(body.mergeRetries).toBe(1);
    expect((body.retryResult as { code?: string })?.code).toBe("AUTO_MERGE_DISABLED");
    expect((body.retryResult as { enqueuedMerge?: boolean })?.enqueuedMerge).toBe(false);

    expect(enqueueMerge).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenCalled();
    const patch = updateTask.mock.calls[0]?.[1] as Partial<Task>;
    expect(patch.status).toBe("awaiting-user-review");
    expect(patch.error).toBeNull();
    expect(patch.autoMerge).toBeUndefined();

    expect(logEntry.mock.calls.some((c) => String(c[1]).includes("AUTO_MERGE_DISABLED"))).toBe(true);
    expect(getTask().autoMerge).toBe(false);
    expect(getTask().prInfo?.number).toBe(19);
    expect(getTask().prInfo?.status).toBe("open");
  });

  it("positive control: Retry with autoMerge=true still uses merge-retry reset path", async () => {
    const { app, updateTask, enqueueMerge, getTask } = buildApp({
      task: mkApp002Fixture({ autoMerge: true }),
      settings: { autoMerge: true },
    });

    const res = await performRequest(app, "POST", "/api/tasks/APP-002-FIXTURE/retry", "{}", {
      "content-type": "application/json",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBeNull();
    expect(res.body.error).toBeNull();
    expect(enqueueMerge).not.toHaveBeenCalled();
    const patch = updateTask.mock.calls[0]?.[1] as Partial<Task>;
    expect(patch.status).toBeNull();
    expect(getTask().autoMerge).toBe(true);
  });
});
