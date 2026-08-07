/*
FNXC:WorkflowAgentRouting 2026-08-07-23:35:
A task may hold only ONE active workflow work item
(`idx_workflow_work_items_one_active_task_continuation`: kind='task' AND state IN
runnable/running/held/retrying). A RESUMED graph run keeps the continuation it woke on active
until the interpreter returns — which is strictly AFTER a later role-classified node needs to
write its own durable principal fence. That fence upsert's ON CONFLICT target is
(run_id, task_id, node_id, kind), a DIFFERENT index, so the stale row does not upsert: the
write raises, routing returns `workflow-principal-fence-unavailable:<role>`, and the run
suspends. Nothing about that state changes between dispatches, so the card deadlocked in its
wip column forever with no task error, and the only recovery was an operator manually bouncing
it back to the hold column (which clears the continuation).

These tests pin the handover invariant and its two limits, because the repair is only safe if
it stays narrow: it must release a row for a node the run has LEFT, must never steal a live
claim on the node currently executing, and must report "nothing released" so the caller still
fails closed rather than looping on a conflict it cannot resolve.
*/

import "./executor-test-helpers.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskExecutor } from "../executor.js";
import { resetExecutorMocks } from "./executor-test-helpers.js";

interface FakeWorkItem {
  id: string;
  taskId: string;
  nodeId: string;
  nodeInstanceId?: string;
  kind: string;
  state: string;
}

function createStore(items: FakeWorkItem[]) {
  const rows = [...items];
  const store = {
    on: vi.fn(),
    off: vi.fn(),
    getRootDir: () => "/tmp/test",
    listWorkflowWorkItemsForTask: vi.fn(async (_taskId: string, _opts?: unknown) => rows),
    transitionWorkflowWorkItem: vi.fn(async (id: string, state: string) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) throw new Error(`unknown work item ${id}`);
      row.state = state;
      return row;
    }),
    recordRunAuditEvent: vi.fn().mockResolvedValue(undefined),
    logEntry: vi.fn().mockResolvedValue(undefined),
  } as any;
  return { store, rows };
}

/** The private repair is reached through routing in production; call it directly here. */
function supersede(
  executor: TaskExecutor,
  taskId: string,
  nodeInstanceId: string,
  nodeId: string,
): Promise<number> {
  return (executor as unknown as {
    supersedeStaleActiveWorkItems: (t: string, i: string, n: string) => Promise<number>;
  }).supersedeStaleActiveWorkItems(taskId, nodeInstanceId, nodeId);
}

describe("workflow continuation slot handover", () => {
  beforeEach(() => {
    resetExecutorMocks();
  });

  it("releases the active continuation of a node the run has already left", async () => {
    const { store, rows } = createStore([
      { id: "wi-parse", taskId: "FN-1", nodeId: "parse", kind: "task", state: "running" },
    ]);
    const executor = new TaskExecutor(store, "/tmp/test");

    const released = await supersede(executor, "FN-1", "steps#0:step-execute", "step-execute");

    expect(released).toBe(1);
    expect(rows.find((row) => row.id === "wi-parse")?.state).toBe("succeeded");
    // Truthful terminal state, and the lease must be dropped so nothing reads it as live.
    expect(store.transitionWorkflowWorkItem).toHaveBeenCalledWith(
      "wi-parse",
      "succeeded",
      expect.objectContaining({ leaseOwner: null, leaseExpiresAt: null }),
    );
  });

  /*
  Every active state the partial unique index covers occupies the slot, so every one of them
  must be releasable — a repair that only handled `running` would still deadlock on a card
  parked `held` by an earlier availability hold.
  */
  it.each(["running", "held", "runnable", "retrying"])(
    "releases a stale continuation in the '%s' state",
    async (state) => {
      const { store, rows } = createStore([
        { id: "wi-stale", taskId: "FN-1", nodeId: "parse", kind: "task", state },
      ]);
      const executor = new TaskExecutor(store, "/tmp/test");

      expect(await supersede(executor, "FN-1", "steps#0:step-execute", "step-execute")).toBe(1);
      expect(rows.find((row) => row.id === "wi-stale")?.state).toBe("succeeded");
    },
  );

  it("never steals a claim on the node currently executing", async () => {
    const { store, rows } = createStore([
      {
        id: "wi-same-node",
        taskId: "FN-1",
        nodeId: "step-execute",
        nodeInstanceId: "steps#0:step-execute",
        kind: "task",
        state: "running",
      },
    ]);
    const executor = new TaskExecutor(store, "/tmp/test");

    // 0 released → the caller must fail closed instead of retrying the fence write.
    expect(await supersede(executor, "FN-1", "steps#0:step-execute", "step-execute")).toBe(0);
    expect(rows.find((row) => row.id === "wi-same-node")?.state).toBe("running");
    expect(store.transitionWorkflowWorkItem).not.toHaveBeenCalled();
  });

  it("leaves already-terminal rows untouched", async () => {
    const { store, rows } = createStore([
      { id: "wi-done", taskId: "FN-1", nodeId: "plan", kind: "task", state: "succeeded" },
      { id: "wi-failed", taskId: "FN-1", nodeId: "plan-review", kind: "task", state: "failed" },
    ]);
    const executor = new TaskExecutor(store, "/tmp/test");

    expect(await supersede(executor, "FN-1", "steps#0:step-execute", "step-execute")).toBe(0);
    expect(store.transitionWorkflowWorkItem).not.toHaveBeenCalled();
    expect(rows.map((row) => row.state)).toEqual(["succeeded", "failed"]);
  });

  /*
  Bookkeeping must never decide the run: an unreadable or unwritable work-item table reports
  "nothing released" so routing fails closed, rather than throwing out of `beforeNodeExecution`
  and terminalizing the task on a storage hiccup.
  */
  it("reports nothing released when the work-item table cannot be read", async () => {
    const { store } = createStore([]);
    store.listWorkflowWorkItemsForTask = vi.fn().mockRejectedValue(new Error("db down"));
    const executor = new TaskExecutor(store, "/tmp/test");

    await expect(supersede(executor, "FN-1", "steps#0:step-execute", "step-execute")).resolves.toBe(0);
  });

  it("reports nothing released when the transition itself fails", async () => {
    const { store, rows } = createStore([
      { id: "wi-parse", taskId: "FN-1", nodeId: "parse", kind: "task", state: "running" },
    ]);
    store.transitionWorkflowWorkItem = vi.fn().mockRejectedValue(new Error("cas lost"));
    const executor = new TaskExecutor(store, "/tmp/test");

    await expect(supersede(executor, "FN-1", "steps#0:step-execute", "step-execute")).resolves.toBe(0);
    expect(rows.find((row) => row.id === "wi-parse")?.state).toBe("running");
  });

  it("degrades to no-op on a store without the work-item API", async () => {
    const executor = new TaskExecutor({ on: vi.fn(), off: vi.fn(), getRootDir: () => "/tmp/test" } as any, "/tmp/test");

    await expect(supersede(executor, "FN-1", "steps#0:step-execute", "step-execute")).resolves.toBe(0);
  });
});
