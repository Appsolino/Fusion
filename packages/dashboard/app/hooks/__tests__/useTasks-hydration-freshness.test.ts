/*
FNXC:MobileTabDiscard 2026-07-26-14:26:
Regression coverage for the freshness half of the mobile tab-discard restore.

Raising `SWR_TASKS_MAX_AGE_MS` from 60s to hours made a hydrated snapshot able to be OLDER than every
downstream freshness threshold for the first time. `lastFetchTimeMs` started as a bare
`useRef(undefined)` that only a successful fetch assigned, so every consumer fell back to `Date.now()`
and measured an hours-old `updatedAt` against NOW: on an iOS-PWA restore all in-progress cards
rendered 'stuck', their agent pulse was suppressed (`isTaskAgentActive({isStuck:true})`), and
Column/ExecutorStatusBar reported the same false counts until the mount revalidation resolved.

The invariant: `lastFetchTimeMs` describes the AGE OF THE ROWS CURRENTLY IN `tasks`, on the FIRST
render, not just after a fetch. Asserted against real localStorage and the real swrCache module —
a mocked cache is what let the missing `savedAt` plumbing hide.
*/
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Task } from "@fusion/core";
import { useTasks } from "../useTasks";
import * as api from "../../api";
import { SWR_CACHE_KEYS } from "../../utils/swrCache";
import { isTaskStuck, countStuckTasks } from "../../utils/taskStuck";
import { isTaskAgentActive } from "../../utils/taskActivity";

vi.mock("../../api", async (importOriginal) => {
  const { createDashboardApiMock } = await import("../../test/mockApi");
  return createDashboardApiMock(() => importOriginal<typeof import("../../api")>(), {
    fetchTasks: vi.fn().mockResolvedValue([]),
  });
});

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 1;
  close = vi.fn(() => {
    this.readyState = 2;
  });
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

const originalEventSource = globalThis.EventSource;
const mockFetchTasks = vi.mocked(api.fetchTasks);
const PROJECT_ID = "proj-freshness";
const CACHE_KEY = `${SWR_CACHE_KEYS.TASKS_PREFIX}${PROJECT_ID}`;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
/** Project default from `packages/core/src/settings-schema.ts`. */
const TASK_STUCK_TIMEOUT_MS = 600_000;

function createInProgressTask(id: string, updatedAtMs: number): Task {
  return {
    id,
    title: `Card ${id}`,
    description: "",
    column: "in-progress",
    status: "executing",
    dependencies: [],
    steps: [],
    log: [],
    createdAt: new Date(updatedAtMs - 60_000).toISOString(),
    updatedAt: new Date(updatedAtMs).toISOString(),
  } as Task;
}

/** Seed the project snapshot with an explicit write time, mimicking a tab discarded `ageMs` ago. */
function seedSnapshot(tasks: Task[], ageMs: number): number {
  const savedAt = Date.now() - ageMs;
  localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt, data: tasks }));
  return savedAt;
}

beforeEach(() => {
  MockEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;
  localStorage.clear();
  mockFetchTasks.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
  localStorage.clear();
  vi.useRealTimers();
});

describe("useTasks hydration freshness (dataAsOfMs)", () => {
  it("reports the envelope savedAt, not now, on the first render after a 2-hour discard", () => {
    const savedAt = seedSnapshot([createInProgressTask("FN-1", Date.now() - TWO_HOURS_MS)], TWO_HOURS_MS);
    // Never resolves: everything asserted here is the pre-revalidation restore frame.
    mockFetchTasks.mockReturnValue(new Promise<Task[]>(() => {}));

    const { result } = renderHook(() => useTasks({ projectId: PROJECT_ID }));

    expect(result.current.tasks.map((task) => task.id)).toEqual(["FN-1"]);
    expect(result.current.lastFetchTimeMs).toBe(savedAt);
  });

  it("does not mark a whole board stuck when the snapshot itself is hours old", () => {
    const savedAt = Date.now() - TWO_HOURS_MS;
    // Each card was updated a minute before the snapshot was written: fresh RELATIVE TO the snapshot,
    // hours old relative to now. This is the operator's 6 in-progress cards after an iOS PWA discard.
    const tasks = Array.from({ length: 6 }, (_, index) =>
      createInProgressTask(`FN-${index}`, savedAt - 60_000),
    );
    seedSnapshot(tasks, TWO_HOURS_MS);
    mockFetchTasks.mockReturnValue(new Promise<Task[]>(() => {}));

    const { result } = renderHook(() => useTasks({ projectId: PROJECT_ID }));
    const dataAsOfMs = result.current.lastFetchTimeMs;

    expect(dataAsOfMs).toBe(savedAt);
    // The reported surface: TaskCard's `isStuck` / status badge.
    for (const task of result.current.tasks) {
      expect(isTaskStuck(task, TASK_STUCK_TIMEOUT_MS, dataAsOfMs)).toBe(false);
    }
    // Column.activeTaskCount and ExecutorStatusBar/useExecutorStats counters read the same clock.
    expect(countStuckTasks(result.current.tasks, TASK_STUCK_TIMEOUT_MS, dataAsOfMs)).toBe(0);
    // TaskCard's agent pulse is suppressed by `isStuck`; with an honest clock it stays lit.
    for (const task of result.current.tasks) {
      const isStuck = isTaskStuck(task, TASK_STUCK_TIMEOUT_MS, dataAsOfMs);
      expect(isTaskAgentActive(task, { isStuck })).toBe(true);
    }

    // Guard the exact regression: the old `undefined` clock (=> Date.now()) called all six stuck.
    expect(countStuckTasks(result.current.tasks, TASK_STUCK_TIMEOUT_MS, undefined)).toBe(6);
  });

  it("still reports a genuinely stuck card as stuck against the snapshot's own clock", () => {
    const savedAt = Date.now() - TWO_HOURS_MS;
    seedSnapshot(
      [
        createInProgressTask("FN-FRESH", savedAt - 60_000),
        // Already idle for 20 minutes when the snapshot was taken.
        createInProgressTask("FN-STUCK", savedAt - 20 * 60_000),
      ],
      TWO_HOURS_MS,
    );
    mockFetchTasks.mockReturnValue(new Promise<Task[]>(() => {}));

    const { result } = renderHook(() => useTasks({ projectId: PROJECT_ID }));
    const dataAsOfMs = result.current.lastFetchTimeMs;

    const stuckIds = result.current.tasks
      .filter((task) => isTaskStuck(task, TASK_STUCK_TIMEOUT_MS, dataAsOfMs))
      .map((task) => task.id);
    expect(stuckIds).toEqual(["FN-STUCK"]);
  });

  it("advances the clock to now once the mount revalidation lands real data", async () => {
    const savedAt = seedSnapshot([createInProgressTask("FN-OLD", Date.now() - TWO_HOURS_MS)], TWO_HOURS_MS);
    mockFetchTasks.mockResolvedValue([createInProgressTask("FN-NEW", Date.now())]);

    const { result } = renderHook(() => useTasks({ projectId: PROJECT_ID }));
    expect(result.current.lastFetchTimeMs).toBe(savedAt);

    await waitFor(() => {
      expect(result.current.tasks.map((task) => task.id)).toEqual(["FN-NEW"]);
    });
    expect(result.current.lastFetchTimeMs).toBeGreaterThan(savedAt);
  });

  it("leaves the clock undefined when there is no snapshot to describe", async () => {
    mockFetchTasks.mockReturnValue(new Promise<Task[]>(() => {}));

    const { result } = renderHook(() => useTasks({ projectId: PROJECT_ID }));

    expect(result.current.tasks).toEqual([]);
    expect(result.current.lastFetchTimeMs).toBeUndefined();
  });

  it("re-anchors the clock to the new project's snapshot on a project switch", async () => {
    const otherProjectId = "proj-freshness-other";
    const otherKey = `${SWR_CACHE_KEYS.TASKS_PREFIX}${otherProjectId}`;
    const firstSavedAt = seedSnapshot([createInProgressTask("FN-A", Date.now() - TWO_HOURS_MS)], TWO_HOURS_MS);
    const otherSavedAt = Date.now() - 30 * 60_000;
    localStorage.setItem(
      otherKey,
      JSON.stringify({ savedAt: otherSavedAt, data: [createInProgressTask("FN-B", otherSavedAt - 60_000)] }),
    );
    mockFetchTasks.mockReturnValue(new Promise<Task[]>(() => {}));

    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) => useTasks({ projectId }),
      { initialProps: { projectId: PROJECT_ID } },
    );
    expect(result.current.lastFetchTimeMs).toBe(firstSavedAt);

    rerender({ projectId: otherProjectId });

    await waitFor(() => {
      expect(result.current.tasks.map((task) => task.id)).toEqual(["FN-B"]);
    });
    expect(result.current.lastFetchTimeMs).toBe(otherSavedAt);
  });
});
