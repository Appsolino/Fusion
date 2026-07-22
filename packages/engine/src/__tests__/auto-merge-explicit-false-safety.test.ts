/**
 * FUS-010 / FUS-029: explicit task.autoMerge=false must never invoke runAiMerge,
 * including for stale queued items and restart-style drain replays.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings, Task } from "@fusion/core";

const testState = vi.hoisted(() => ({
  currentStore: null as MockTaskStore | null,
  runAiMerge: vi.fn(),
}));

vi.mock("../merger.js", () => ({
  sweepStaleAutostashes: vi.fn(async () => undefined),
  VerificationError: class VerificationError extends Error {
    verificationResult: unknown;
    constructor(message: string, verificationResult: unknown) {
      super(message);
      this.name = "VerificationError";
      this.verificationResult = verificationResult;
    }
  },
}));

vi.mock("../merger-ai.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../merger-ai.js")>();
  return {
    ...actual,
    runAiMerge: testState.runAiMerge,
  };
});

vi.mock("../runtimes/in-process-runtime.js", () => ({
  InProcessRuntime: vi.fn().mockImplementation(function () {
    return {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getTaskStore: () => testState.currentStore,
      getAgentStore: vi.fn(),
      getMessageStore: vi.fn(),
      getRoutineStore: vi.fn(),
      getRoutineRunner: vi.fn(),
      getHeartbeatMonitor: vi.fn(),
      getTriggerScheduler: vi.fn(),
      configurePrMonitoring: vi.fn(),
      setActiveMergeTaskIdProvider: vi.fn(),
      setActiveMergeStartedAtMsProvider: vi.fn(),
      setActiveMergeAborter: vi.fn(),
      setMergeEnqueuer: vi.fn(),
      setMergeActiveClearer: vi.fn(),
      setMergePendingProvider: vi.fn(),
      setMergeRequester: vi.fn(),
      resumeAfterUnpause: vi.fn(async () => undefined),
      getPluginRunner: vi.fn(() => undefined),
    };
  }),
}));

import { ProjectEngine } from "../project-engine.js";
import { runAiMerge } from "../merger-ai.js";

type MockTask = {
  id: string;
  column: "in-review" | "done";
  mergeRetries: number;
  status: string | null;
  error: string | null;
  paused?: boolean;
  autoMerge?: boolean;
  steps?: Array<{ status: string }>;
  prInfo?: { number: number; status: string };
  updatedAt: string;
  log: Array<{ action?: string }>;
};

type MockTaskStore = {
  getSettings: ReturnType<typeof vi.fn>;
  listTasks: ReturnType<typeof vi.fn>;
  getTask: ReturnType<typeof vi.fn>;
  updateTask: ReturnType<typeof vi.fn>;
  addTaskComment: ReturnType<typeof vi.fn>;
  moveTask: ReturnType<typeof vi.fn>;
  logEntry: ReturnType<typeof vi.fn>;
  getActiveMergingTask: ReturnType<typeof vi.fn>;
  createTask: ReturnType<typeof vi.fn>;
  recordRunAuditEvent: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
};

const TASK_ID = "APP-002-FIXTURE";

function makeTask(overrides: Partial<MockTask> = {}): MockTask {
  return {
    id: TASK_ID,
    column: "in-review",
    mergeRetries: 0,
    status: null,
    error: null,
    autoMerge: false,
    steps: [{ status: "done" }],
    prInfo: { number: 19, status: "open" },
    updatedAt: new Date().toISOString(),
    log: [],
    ...overrides,
  };
}

function makeStore(task: MockTask, settings: Partial<Settings> = {}): MockTaskStore {
  let current = { ...task };
  return {
    getSettings: vi.fn(async () => ({
      autoMerge: true,
      autoResolveConflicts: true,
      globalPause: false,
      enginePaused: false,
      pollIntervalMs: 15_000,
      ...settings,
    })),
    listTasks: vi.fn(async () => [current]),
    getTask: vi.fn(async () => current),
    updateTask: vi.fn(async (_id: string, patch: Partial<MockTask>) => {
      current = { ...current, ...patch };
      return current;
    }),
    addTaskComment: vi.fn(async () => undefined),
    moveTask: vi.fn(async () => undefined),
    logEntry: vi.fn(async () => undefined),
    getActiveMergingTask: vi.fn(() => null),
    createTask: vi.fn(async () => ({ id: "FN-9999" })),
    recordRunAuditEvent: vi.fn(async () => undefined),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function createEngine(store: MockTaskStore): ProjectEngine {
  testState.currentStore = store;
  return new ProjectEngine(
    {
      projectId: "proj_test",
      workingDirectory: "/tmp/proj_test",
      isolationMode: "in-process",
      maxConcurrent: 1,
      maxWorktrees: 1,
    },
    {} as never,
    { skipNotifier: true },
  );
}

async function drainQueued(engine: ProjectEngine, taskId = TASK_ID): Promise<void> {
  const privateEngine = engine as unknown as {
    mergeQueue: string[];
    mergeActive: Set<string>;
    drainMergeQueue: () => Promise<void>;
  };
  privateEngine.mergeActive.add(taskId);
  privateEngine.mergeQueue.push(taskId);
  await privateEngine.drainMergeQueue();
}

describe("FUS-010 auto-merge explicit false safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runAiMerge).mockReset();
    testState.currentStore = null;
  });

  it("discards stale queued merge when task.autoMerge=false despite project true", async () => {
    const store = makeStore(makeTask({ autoMerge: false, status: "merging" }), { autoMerge: true });
    const engine = createEngine(store);

    await drainQueued(engine);

    expect(runAiMerge).not.toHaveBeenCalled();
    expect(store.logEntry.mock.calls.some((c) => String(c[1]).includes("AUTO_MERGE_DISABLED"))).toBe(true);
    const updated = await store.getTask(TASK_ID);
    expect(updated?.status).toBe("awaiting-user-review");
    expect(updated?.error).toBeNull();
    expect(updated?.autoMerge).toBe(false);
    expect(updated?.prInfo?.status).toBe("open");
    expect(updated?.column).toBe("in-review");
  });

  it("project autoMerge=true does not override task false at admission", async () => {
    const store = makeStore(makeTask({ autoMerge: false }), { autoMerge: true });
    const engine = createEngine(store);
    const privateEngine = engine as unknown as {
      enqueueEligibleInReviewTasks: (
        tasks: Task[],
        settings: Pick<Settings, "autoMerge" | "maxAutoMergeRetries">,
      ) => Promise<number>;
      mergeQueue: string[];
    };

    const enqueued = await privateEngine.enqueueEligibleInReviewTasks(
      [await store.getTask(TASK_ID)] as Task[],
      { autoMerge: true },
    );

    expect(enqueued).toBe(0);
    expect(privateEngine.mergeQueue).toEqual([]);
    expect(runAiMerge).not.toHaveBeenCalled();
  });

  it("service-restart style drain cannot replay merge when task is false", async () => {
    // Simulate recovery restoring a previously queued id while task.autoMerge flipped to false.
    const store = makeStore(
      makeTask({ autoMerge: false, status: "failed", error: "Pull request cannot be merged due to conflicts." }),
      { autoMerge: true },
    );
    const engine = createEngine(store);
    await drainQueued(engine);

    expect(runAiMerge).not.toHaveBeenCalled();
    const updated = await store.getTask(TASK_ID);
    expect(updated?.status).toBe("awaiting-user-review");
    expect(updated?.error).toBeNull();
    expect(updated?.column).toBe("in-review");
  });

  it("positive control: effective autoMerge=true still invokes runAiMerge", async () => {
    vi.mocked(runAiMerge).mockResolvedValue({
      task: makeTask({ autoMerge: true }) as unknown as Task,
      branch: "fusion/app-002",
      merged: true,
      noOp: false,
      worktreeRemoved: false,
      branchDeleted: false,
    } as never);

    const store = makeStore(makeTask({ autoMerge: true, status: null }), { autoMerge: true });
    const engine = createEngine(store);
    await drainQueued(engine);

    expect(runAiMerge).toHaveBeenCalled();
  });

  it("mergeRetries cannot bypass the effective-auto-merge guard", async () => {
    const store = makeStore(
      makeTask({ autoMerge: false, mergeRetries: 3, status: "failed", error: "transient" }),
      { autoMerge: true },
    );
    const engine = createEngine(store);
    await drainQueued(engine);

    expect(runAiMerge).not.toHaveBeenCalled();
    expect(store.logEntry.mock.calls.some((c) => String(c[1]).includes("AUTO_MERGE_DISABLED"))).toBe(true);
  });

  it("awaiting-user-review is not admitted to the merge queue", async () => {
    const store = makeStore(
      makeTask({ autoMerge: false, status: "awaiting-user-review" }),
      { autoMerge: true },
    );
    const engine = createEngine(store);
    const privateEngine = engine as unknown as {
      enqueueEligibleInReviewTasks: (
        tasks: Task[],
        settings: Pick<Settings, "autoMerge" | "maxAutoMergeRetries">,
      ) => Promise<number>;
    };
    const enqueued = await privateEngine.enqueueEligibleInReviewTasks(
      [await store.getTask(TASK_ID)] as Task[],
      { autoMerge: true },
    );
    expect(enqueued).toBe(0);
    expect(runAiMerge).not.toHaveBeenCalled();
  });

  it("interpreter waiter without forceManual cannot bypass hard-guard when task.autoMerge=false", async () => {
    const store = makeStore(makeTask({ autoMerge: false, status: null }), { autoMerge: true });
    const engine = createEngine(store);
    await engine.start();
    const privateEngine = engine as unknown as {
      enqueueMergeAwait: (taskId: string, options?: { forceManual?: boolean }) => Promise<unknown>;
    };

    const result = await privateEngine.enqueueMergeAwait(TASK_ID, { forceManual: false }) as {
      merged?: boolean;
      noOp?: boolean;
    };

    expect(runAiMerge).not.toHaveBeenCalled();
    expect(result.merged).toBe(false);
    expect(result.noOp).toBe(true);
    await engine.stop();
  });

  it("human forceManual onMerge still invokes runAiMerge when task.autoMerge=false", async () => {
    vi.mocked(runAiMerge).mockResolvedValue({
      task: makeTask({ autoMerge: false }) as unknown as Task,
      branch: "fusion/app-002",
      merged: true,
      noOp: false,
      worktreeRemoved: false,
      branchDeleted: false,
    } as never);

    const store = makeStore(makeTask({ autoMerge: false, status: null }), { autoMerge: true });
    const engine = createEngine(store);
    await engine.start();
    const result = await engine.onMerge(TASK_ID);

    expect(runAiMerge).toHaveBeenCalled();
    expect(result.merged).toBe(true);
    expect(vi.mocked(runAiMerge).mock.calls[0]?.[3]).toMatchObject({ manual: true });
    await engine.stop();
  });
});
