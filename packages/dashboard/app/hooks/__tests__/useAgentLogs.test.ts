import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAgentLogs, MAX_LOG_ENTRIES, isLogGapMarker } from "../useAgentLogs";
import { __resetSseBus } from "../../sse-bus";
import { fetchAgentLogsWithMeta } from "../../api";

// Mock the api module
vi.mock("../../api", () => ({
  fetchAgentLogsWithMeta: vi.fn().mockResolvedValue({ entries: [], total: 0, hasMore: false }),
}));

const mockFetchAgentLogsWithMeta = vi.mocked(fetchAgentLogsWithMeta);

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners: Record<string, ((e: any) => void)[]> = {};
  readyState = 0;
  close = vi.fn(() => {
    this.readyState = 2;
  });

  constructor(url: string) {
    this.url = url;
    this.readyState = 1;
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, fn: (e: any) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  // Helper to simulate a server event
  _emit(event: string, data: any) {
    for (const fn of this.listeners[event] || []) {
      fn({ data: JSON.stringify(data) });
    }
  }

  /*
  FNXC:AgentLogResync 2026-07-26-14:52:
  Fires a payload-less transport event ("open"/"error"). The sse-bus turns the SECOND `open` on a
  channel into `onReconnect`, which is exactly the shape of the hidden-tab suspend/resume: the socket
  is torn down while hidden and reopened on return, and the stream replays nothing it emitted in
  between.
  */
  _fire(event: string) {
    for (const fn of this.listeners[event] || []) {
      fn({});
    }
  }
}

const originalEventSource = globalThis.EventSource;

const INITIAL_LOAD_LIMIT = 100;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  __resetSseBus();
  MockEventSource.instances = [];
  (globalThis as any).EventSource = MockEventSource;
  mockFetchAgentLogsWithMeta.mockReset().mockResolvedValue({ entries: [], total: 0, hasMore: false });
});

afterEach(() => {
  (globalThis as any).EventSource = originalEventSource;
});

describe("useAgentLogs", () => {
  it("does not fetch or connect when enabled=false", () => {
    const { result } = renderHook(() => useAgentLogs("FN-001", false));

    expect(mockFetchAgentLogsWithMeta).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(0);
    expect(result.current.entries).toEqual([]);
  });

  it("reports loading immediately when enabled until initial history fetch completes", async () => {
    const deferred = createDeferred<{ entries: []; total: number; hasMore: boolean }>();
    mockFetchAgentLogsWithMeta.mockReturnValueOnce(deferred.promise);

    const { result } = renderHook(() => useAgentLogs("FN-001", true));

    expect(result.current.loading).toBe(true);
    expect(result.current.entries).toEqual([]);

    await act(async () => {
      deferred.resolve({ entries: [], total: 0, hasMore: false });
      await deferred.promise;
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.entries).toEqual([]);
  });

  it("fetches historical logs and opens SSE when enabled=true", async () => {
    const historicalLogs = [
      { timestamp: "2026-01-01T00:00:00Z", taskId: "FN-001", text: "old", type: "text" as const },
    ];
    mockFetchAgentLogsWithMeta.mockResolvedValueOnce({
      entries: historicalLogs,
      total: historicalLogs.length,
      hasMore: false,
    });

    const { result } = renderHook(() => useAgentLogs("FN-001", true));

    await waitFor(() => {
      expect(result.current.entries).toEqual(historicalLogs);
    });

    expect(mockFetchAgentLogsWithMeta).toHaveBeenCalledWith("FN-001", undefined, { limit: INITIAL_LOAD_LIMIT });
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/tasks/FN-001/logs/stream");
  });

  it("sets hasMore and total from API response", async () => {
    mockFetchAgentLogsWithMeta.mockResolvedValueOnce({
      entries: [],
      total: 150,
      hasMore: true,
    });

    const { result } = renderHook(() => useAgentLogs("FN-001", true));

    await waitFor(() => {
      expect(result.current.total).toBe(150);
      expect(result.current.hasMore).toBe(true);
    });
  });

  it("appends live SSE entries to historical entries", async () => {
    mockFetchAgentLogsWithMeta.mockResolvedValueOnce({
      entries: [
        { timestamp: "2026-01-01T00:00:00Z", taskId: "FN-001", text: "old", type: "text" as const },
      ],
      total: 2,
      hasMore: false,
    });

    const { result } = renderHook(() => useAgentLogs("FN-001", true));

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });

    const es = MockEventSource.instances[0];
    act(() => {
      es._emit("agent:log", {
        timestamp: "2026-01-01T00:01:00Z",
        taskId: "FN-001",
        text: "new",
        type: "text",
      });
    });

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[1].text).toBe("new");
  });

  it("keeps deterministic chronological order when history has tied timestamps and SSE appends tied timestamps", async () => {
    mockFetchAgentLogsWithMeta.mockResolvedValueOnce({
      entries: [
        { timestamp: "2026-01-01T00:00:00Z", taskId: "FN-001", text: "hist-1", type: "text" as const },
        { timestamp: "2026-01-01T00:00:00Z", taskId: "FN-001", text: "hist-2", type: "text" as const },
      ],
      total: 3,
      hasMore: false,
    });

    const { result } = renderHook(() => useAgentLogs("FN-001", true));

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.text)).toEqual(["hist-1", "hist-2"]);
    });

    const es = MockEventSource.instances[0];
    act(() => {
      es._emit("agent:log", {
        timestamp: "2026-01-01T00:00:00Z",
        taskId: "FN-001",
        text: "live-3",
        type: "text",
      });
    });

    expect(result.current.entries.map((entry) => entry.text)).toEqual(["hist-1", "hist-2", "live-3"]);
  });

  it("closes SSE when enabled changes to false", async () => {
    mockFetchAgentLogsWithMeta.mockResolvedValueOnce({ entries: [], total: 0, hasMore: false });

    const { rerender } = renderHook(
      ({ enabled }) => useAgentLogs("FN-001", enabled),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1);
    });

    const es = MockEventSource.instances[0];

    rerender({ enabled: false });

    expect(es.close).toHaveBeenCalled();
  });

  it("closes SSE on unmount", async () => {
    mockFetchAgentLogsWithMeta.mockResolvedValueOnce({ entries: [], total: 0, hasMore: false });

    const { unmount } = renderHook(() => useAgentLogs("FN-001", true));

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1);
    });

    const es = MockEventSource.instances[0];

    unmount();

    expect(es.close).toHaveBeenCalled();
  });

  it("keeps oversized historical logs without truncating older entries", async () => {
    const oversizedCount = 525;
    const historicalLogs = Array.from({ length: oversizedCount }, (_, index) => ({
      timestamp: `2026-01-01T00:${String(index).padStart(2, "0")}:00Z`,
      taskId: "FN-001",
      text: `entry-${index}`,
      type: "text" as const,
    }));
    mockFetchAgentLogsWithMeta.mockResolvedValueOnce({
      entries: historicalLogs,
      total: historicalLogs.length,
      hasMore: false,
    });

    const { result } = renderHook(() => useAgentLogs("FN-001", true));

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(oversizedCount);
    });

    expect(result.current.entries[0].text).toBe("entry-0");
    expect(result.current.entries.at(-1)?.text).toBe(`entry-${oversizedCount - 1}`);
  });

  /*
  FNXC:MobileTabRetention 2026-07-26-12:20:
  This case previously asserted the live SSE tail was retained WITHOUT truncation. That contract is
  deliberately reversed: an unbounded tail grows the resident set for the whole session, which is what
  makes a mobile browser discard the backgrounded tab (white-splash reload on return). The tail is now
  a bounded ring at MAX_LOG_ENTRIES, and `hasMore` is forced true once it trims so the reader always
  keeps a "load older" affordance rather than seeing a silently-clipped tail.
  */
  it("bounds the live SSE tail at MAX_LOG_ENTRIES and signals truncation via hasMore", async () => {
    const streamedCount = 520;
    mockFetchAgentLogsWithMeta.mockResolvedValueOnce({ entries: [], total: streamedCount, hasMore: false });

    const { result } = renderHook(() => useAgentLogs("FN-001", true));

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1);
    });

    const es = MockEventSource.instances[0];
    act(() => {
      for (let index = 0; index < streamedCount; index++) {
        es._emit("agent:log", {
          timestamp: `2026-01-01T00:${String(index).padStart(2, "0")}:00Z`,
          taskId: "FN-001",
          text: `live-${index}`,
          type: "text",
        });
      }
    });

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(MAX_LOG_ENTRIES);
    });

    expect(result.current.entries[0].text).toBe(`live-${streamedCount - MAX_LOG_ENTRIES}`);
    expect(result.current.entries.at(-1)?.text).toBe(`live-${streamedCount - 1}`);
    expect(result.current.hasMore).toBe(true);
  });

  it("does not fetch when taskId is null", () => {
    renderHook(() => useAgentLogs(null, true));

    expect(mockFetchAgentLogsWithMeta).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("preserves long text and detail in historical log entries without truncation", async () => {
    const longText = "A".repeat(5000);
    const longDetail = "B".repeat(5000);
    mockFetchAgentLogsWithMeta.mockResolvedValueOnce({
      entries: [
        { timestamp: "2026-01-01T00:00:00Z", taskId: "FN-001", text: longText, type: "text" as const },
        { timestamp: "2026-01-01T00:00:01Z", taskId: "FN-001", text: "Read", type: "tool" as const, detail: longDetail },
      ],
      total: 2,
      hasMore: false,
    });

    const { result } = renderHook(() => useAgentLogs("FN-001", true));

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });

    expect(result.current.entries[0].text).toBe(longText);
    expect(result.current.entries[0].text.length).toBe(5000);
    expect(result.current.entries[1].detail).toBe(longDetail);
    expect(result.current.entries[1].detail!.length).toBe(5000);
  });

  it("preserves long text and detail in live SSE entries without truncation", async () => {
    mockFetchAgentLogsWithMeta.mockResolvedValueOnce({ entries: [], total: 1, hasMore: false });

    const { result } = renderHook(() => useAgentLogs("FN-001", true));

    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1);
    });

    const longText = "X".repeat(5000);
    const longDetail = "Y".repeat(5000);
    const es = MockEventSource.instances[0];
    act(() => {
      es._emit("agent:log", {
        timestamp: "2026-01-01T00:01:00Z",
        taskId: "FN-001",
        text: longText,
        type: "text",
        detail: longDetail,
      });
    });

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });

    expect(result.current.entries[0].text).toBe(longText);
    expect(result.current.entries[0].text.length).toBe(5000);
    expect(result.current.entries[0].detail).toBe(longDetail);
    expect(result.current.entries[0].detail!.length).toBe(5000);
  });

  describe("loadMore", () => {
    it("loadMore fetches older entries and prepends them", async () => {
      const initialLogs = [
        { timestamp: "2026-01-01T00:00:00Z", taskId: "FN-001", text: "newer", type: "text" as const },
      ];
      const olderLogs = [
        { timestamp: "2026-01-01T00:00:00Z", taskId: "FN-001", text: "older", type: "text" as const },
      ];

      mockFetchAgentLogsWithMeta
        .mockResolvedValueOnce({ entries: initialLogs, total: 2, hasMore: true })
        .mockResolvedValueOnce({ entries: olderLogs, total: 2, hasMore: false });

      const { result } = renderHook(() => useAgentLogs("FN-001", true));

      await waitFor(() => {
        expect(result.current.entries).toHaveLength(1);
        expect(result.current.hasMore).toBe(true);
      });

      // Call loadMore
      await act(async () => {
        await result.current.loadMore();
      });

      // Should now have 2 entries in chronological order: older + initial
      expect(result.current.entries).toHaveLength(2);
      expect(result.current.entries[0].text).toBe("older");
      expect(result.current.entries[1].text).toBe("newer");
      expect(result.current.hasMore).toBe(false);
    });

    it("loadMore preserves chronological order with near-equal timestamps", async () => {
      const initialLogs = [
        { timestamp: "2026-01-01T00:00:01.001Z", taskId: "FN-001", text: "middle", type: "text" as const },
        { timestamp: "2026-01-01T00:00:01.002Z", taskId: "FN-001", text: "newest", type: "text" as const },
      ];
      const olderLogs = [
        { timestamp: "2026-01-01T00:00:00.999Z", taskId: "FN-001", text: "oldest-a", type: "text" as const },
        { timestamp: "2026-01-01T00:00:00.999Z", taskId: "FN-001", text: "oldest-b", type: "text" as const },
      ];

      mockFetchAgentLogsWithMeta
        .mockResolvedValueOnce({ entries: initialLogs, total: 4, hasMore: true })
        .mockResolvedValueOnce({ entries: olderLogs, total: 4, hasMore: false });

      const { result } = renderHook(() => useAgentLogs("FN-001", true));

      await waitFor(() => {
        expect(result.current.entries.map((entry) => entry.text)).toEqual(["middle", "newest"]);
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(result.current.entries.map((entry) => entry.text)).toEqual([
        "oldest-a",
        "oldest-b",
        "middle",
        "newest",
      ]);
    });

    /*
    FNXC:MobileTabRetention 2026-07-26-12:24:
    A user-paged buffer (550 via loadMore) is HELD at its expanded size rather than collapsed back to
    MAX_LOG_ENTRIES — capping a prepend of older pages would discard exactly what the user just asked
    for. Streaming past that ceiling drops one oldest entry per new line so the buffer stops growing.
    */
    it("holds a user-paged buffer at its size while streaming, dropping the oldest entry", async () => {
      const initialLogs = Array.from({ length: 300 }, (_, index) => ({
        timestamp: `2026-01-02T00:${String(index).padStart(2, "0")}:00Z`,
        taskId: "FN-001",
        text: `initial-${index}`,
        type: "text" as const,
      }));
      const olderLogs = Array.from({ length: 250 }, (_, index) => ({
        timestamp: `2026-01-01T00:${String(index).padStart(2, "0")}:00Z`,
        taskId: "FN-001",
        text: `older-${index}`,
        type: "text" as const,
      }));

      mockFetchAgentLogsWithMeta
        .mockResolvedValueOnce({ entries: initialLogs, total: 550, hasMore: true })
        .mockResolvedValueOnce({ entries: olderLogs, total: 550, hasMore: false });

      const { result } = renderHook(() => useAgentLogs("FN-001", true));

      await waitFor(() => {
        expect(result.current.entries).toHaveLength(300);
      });

      await act(async () => {
        await result.current.loadMore();
      });

      await waitFor(() => {
        expect(result.current.entries).toHaveLength(550);
      });

      const es = MockEventSource.instances[0];
      act(() => {
        es._emit("agent:log", {
          timestamp: "2026-01-03T00:00:00Z",
          taskId: "FN-001",
          text: "live-after-large-history",
          type: "text",
        });
      });

      await waitFor(() => {
        expect(result.current.entries.at(-1)?.text).toBe("live-after-large-history");
      });

      expect(result.current.entries).toHaveLength(550);
      expect(result.current.entries[0].text).toBe("older-1");
    });

    /*
    FNXC:AgentLogPaging 2026-07-26-15:14:
    The live-tail trim flag used to be cleared only by clear() or a task/project switch, so it was
    OR-ed into `hasMore` forever: after paging back to entry 0 the server said hasMore:false and the
    hook still reported true. The "load older" control stayed rendered and every further click
    fetched past the end and changed nothing, so the reader could not distinguish "beginning of log"
    from "broken control". `hasMore` must be true iff older entries actually remain server-side.
    */
    it("reports hasMore false once paging reaches the beginning after a live-tail trim", async () => {
      const streamedCount = 520;
      mockFetchAgentLogsWithMeta.mockResolvedValueOnce({ entries: [], total: streamedCount, hasMore: false });

      const { result } = renderHook(() => useAgentLogs("FN-001", true));

      await waitFor(() => {
        expect(MockEventSource.instances).toHaveLength(1);
      });

      const es = MockEventSource.instances[0];
      act(() => {
        for (let index = 0; index < streamedCount; index++) {
          es._emit("agent:log", {
            timestamp: `2026-01-01T00:${String(index).padStart(2, "0")}:00Z`,
            taskId: "FN-001",
            text: `live-${index}`,
            type: "text",
          });
        }
      });

      await waitFor(() => {
        expect(result.current.entries).toHaveLength(MAX_LOG_ENTRIES);
        expect(result.current.hasMore).toBe(true);
      });

      // The trimmed 20 entries are everything that remained; this page reaches entry 0.
      const trimmedAway = Array.from({ length: streamedCount - MAX_LOG_ENTRIES }, (_, index) => ({
        timestamp: `2026-01-01T00:${String(index).padStart(2, "0")}:00Z`,
        taskId: "FN-001",
        text: `live-${index}`,
        type: "text" as const,
      }));
      mockFetchAgentLogsWithMeta.mockResolvedValueOnce({
        entries: trimmedAway,
        total: streamedCount,
        hasMore: false,
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(mockFetchAgentLogsWithMeta).toHaveBeenLastCalledWith("FN-001", undefined, {
        limit: INITIAL_LOAD_LIMIT,
        offset: MAX_LOG_ENTRIES,
      });
      expect(result.current.entries).toHaveLength(streamedCount);
      expect(result.current.hasMore).toBe(false);
    });

    it("loadMore does not trigger when already loading more", async () => {
      mockFetchAgentLogsWithMeta.mockResolvedValue({ entries: [], total: 200, hasMore: true });

      const { result } = renderHook(() => useAgentLogs("FN-001", true));

      await waitFor(() => {
        expect(result.current.hasMore).toBe(true);
      });

      // Start loading more
      const loadMorePromise = act(async () => {
        await result.current.loadMore();
      });

      // While loading, try to load more again - should be ignored
      act(() => {
        result.current.loadMore();
      });

      await loadMorePromise;

      // Initial call + loadMore call (2 total), ignoring re-render calls
      expect(mockFetchAgentLogsWithMeta.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  /*
  FNXC:AgentLogResync 2026-07-26-15:02:
  Regression cover for the silent log gap. `/api/tasks/:id/logs/stream` replays nothing on open, so
  every line emitted while the channel is down (SSE error, heartbeat timeout, or the hidden-tab
  suspend introduced for mobile tab retention) used to vanish from a list that still looked
  contiguous. The invariant asserted here is surface-independent: after ANY reconnect the rendered
  list either contains the missed lines, in order and without duplicates, or shows an explicit gap
  marker. It must never imply continuity it cannot prove.
  */
  describe("reconnect resync", () => {
    const logEntry = (minute: number, text: string) => ({
      timestamp: `2026-01-01T00:${String(minute).padStart(2, "0")}:00Z`,
      taskId: "FN-001",
      text,
      type: "text" as const,
    });

    it("refetches authoritative state on reconnect and restores lines emitted while suspended", async () => {
      const history = [logEntry(0, "hist-1"), logEntry(1, "hist-2")];
      mockFetchAgentLogsWithMeta.mockResolvedValueOnce({ entries: history, total: 2, hasMore: false });

      const { result } = renderHook(() => useAgentLogs("FN-001", true));

      await waitFor(() => {
        expect(result.current.entries).toHaveLength(2);
      });

      const es = MockEventSource.instances[0];
      act(() => {
        es._fire("open");
      });
      act(() => {
        es._emit("agent:log", logEntry(2, "live-3"));
      });
      expect(result.current.entries.map((entry) => entry.text)).toEqual(["hist-1", "hist-2", "live-3"]);

      // Suspended: the server kept writing, and the stream delivered none of it.
      mockFetchAgentLogsWithMeta.mockResolvedValueOnce({
        entries: [...history, logEntry(2, "live-3"), logEntry(3, "missed-4"), logEntry(4, "missed-5")],
        total: 5,
        hasMore: false,
      });

      await act(async () => {
        es._fire("open");
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.entries.map((entry) => entry.text)).toEqual([
          "hist-1",
          "hist-2",
          "live-3",
          "missed-4",
          "missed-5",
        ]);
      });
      expect(new Set(result.current.entries.map((entry) => entry.text)).size).toBe(5);
      expect(result.current.entries.some(isLogGapMarker)).toBe(false);
    });

    it("renders an explicit gap marker when the missed window exceeds one authoritative page", async () => {
      mockFetchAgentLogsWithMeta.mockResolvedValueOnce({
        entries: [logEntry(0, "before-suspend")],
        total: 1,
        hasMore: false,
      });

      const { result } = renderHook(() => useAgentLogs("FN-001", true));

      await waitFor(() => {
        expect(result.current.entries).toHaveLength(1);
      });

      const es = MockEventSource.instances[0];
      act(() => {
        es._fire("open");
      });

      // 400 entries were written while hidden; the newest page shares nothing with the buffer.
      const authoritativePage = Array.from({ length: INITIAL_LOAD_LIMIT }, (_, index) =>
        logEntry(index + 5, `missed-${index}`),
      );
      mockFetchAgentLogsWithMeta.mockResolvedValueOnce({
        entries: authoritativePage,
        total: 401,
        hasMore: true,
      });

      await act(async () => {
        es._fire("open");
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.entries).toHaveLength(INITIAL_LOAD_LIMIT + 1);
      });

      expect(isLogGapMarker(result.current.entries[0])).toBe(true);
      expect(result.current.entries[0].text.length).toBeGreaterThan(0);
      expect(result.current.entries.slice(1).map((entry) => entry.text)).toEqual(
        authoritativePage.map((entry) => entry.text),
      );
      // The unreconcilable prefix is not silently glued onto a page it does not touch.
      expect(result.current.entries.some((entry) => entry.text === "before-suspend")).toBe(false);
      expect(result.current.hasMore).toBe(true);
    });

    it("does not duplicate a live entry that also comes back in the reconnect refetch", async () => {
      mockFetchAgentLogsWithMeta.mockResolvedValueOnce({ entries: [], total: 0, hasMore: false });

      const { result } = renderHook(() => useAgentLogs("FN-001", true));

      await waitFor(() => {
        expect(MockEventSource.instances).toHaveLength(1);
      });

      const es = MockEventSource.instances[0];
      act(() => {
        es._fire("open");
      });

      const refetch = createDeferred<{ entries: any[]; total: number; hasMore: boolean }>();
      mockFetchAgentLogsWithMeta.mockReturnValueOnce(refetch.promise);

      act(() => {
        es._fire("open");
      });

      // Races the in-flight refetch and is also already persisted server-side.
      act(() => {
        es._emit("agent:log", logEntry(1, "raced"));
      });

      await act(async () => {
        refetch.resolve({ entries: [logEntry(0, "page-1"), logEntry(1, "raced")], total: 2, hasMore: false });
        await refetch.promise;
      });

      await waitFor(() => {
        expect(result.current.entries.map((entry) => entry.text)).toEqual(["page-1", "raced"]);
      });
    });

    it("keeps a live entry that raced the reconnect refetch but is not in the page", async () => {
      mockFetchAgentLogsWithMeta.mockResolvedValueOnce({ entries: [], total: 0, hasMore: false });

      const { result } = renderHook(() => useAgentLogs("FN-001", true));

      await waitFor(() => {
        expect(MockEventSource.instances).toHaveLength(1);
      });

      const es = MockEventSource.instances[0];
      act(() => {
        es._fire("open");
      });

      const refetch = createDeferred<{ entries: any[]; total: number; hasMore: boolean }>();
      mockFetchAgentLogsWithMeta.mockReturnValueOnce(refetch.promise);

      act(() => {
        es._fire("open");
      });
      act(() => {
        es._emit("agent:log", logEntry(2, "raced-later"));
      });

      await act(async () => {
        refetch.resolve({ entries: [logEntry(0, "page-1")], total: 1, hasMore: false });
        await refetch.promise;
      });

      await waitFor(() => {
        expect(result.current.entries.map((entry) => entry.text)).toEqual(["page-1", "raced-later"]);
      });
    });

    it("keeps streaming into the buffer when the reconnect refetch fails", async () => {
      mockFetchAgentLogsWithMeta.mockResolvedValueOnce({
        entries: [logEntry(0, "hist-1")],
        total: 1,
        hasMore: false,
      });

      const { result } = renderHook(() => useAgentLogs("FN-001", true));

      await waitFor(() => {
        expect(result.current.entries).toHaveLength(1);
      });

      const es = MockEventSource.instances[0];
      act(() => {
        es._fire("open");
      });

      mockFetchAgentLogsWithMeta.mockRejectedValueOnce(new Error("network down"));

      await act(async () => {
        es._fire("open");
        await Promise.resolve();
      });
      act(() => {
        es._emit("agent:log", logEntry(1, "after-failed-resync"));
      });

      await waitFor(() => {
        expect(result.current.entries.map((entry) => entry.text)).toEqual(["hist-1", "after-failed-resync"]);
      });
    });
  });

  describe("projectId support", () => {
    it("includes projectId in EventSource URL when provided", async () => {
      mockFetchAgentLogsWithMeta.mockResolvedValueOnce({ entries: [], total: 0, hasMore: false });

      renderHook(() => useAgentLogs("FN-001", true, "proj-123"));

      await waitFor(() => {
        expect(MockEventSource.instances).toHaveLength(1);
        expect(MockEventSource.instances[0].url).toBe("/api/tasks/FN-001/logs/stream?projectId=proj-123");
      });
    });

    it("includes projectId in fetchAgentLogsWithMeta call when provided", async () => {
      mockFetchAgentLogsWithMeta.mockResolvedValueOnce({ entries: [], total: 0, hasMore: false });

      renderHook(() => useAgentLogs("FN-001", true, "proj-123"));

      await waitFor(() => {
        expect(mockFetchAgentLogsWithMeta).toHaveBeenCalledWith("FN-001", "proj-123", { limit: INITIAL_LOAD_LIMIT });
      });
    });

    it("does not include projectId in URL when not provided", async () => {
      mockFetchAgentLogsWithMeta.mockResolvedValueOnce({ entries: [], total: 0, hasMore: false });

      renderHook(() => useAgentLogs("FN-001", true));

      await waitFor(() => {
        expect(MockEventSource.instances).toHaveLength(1);
        expect(MockEventSource.instances[0].url).toBe("/api/tasks/FN-001/logs/stream");
      });
    });

    it("clears entries and reports loading immediately when projectId changes", async () => {
      const secondFetch = createDeferred<{
        entries: Array<{ timestamp: string; taskId: string; text: string; type: "text" }>;
        total: number;
        hasMore: boolean;
      }>();
      mockFetchAgentLogsWithMeta
        .mockResolvedValueOnce({
          entries: [{ timestamp: "2026-01-01T00:00:00Z", taskId: "FN-001", text: "proj-A-log", type: "text" as const }],
          total: 1,
          hasMore: false,
        })
        .mockReturnValueOnce(secondFetch.promise);

      const { result, rerender } = renderHook(
        ({ projectId }) => useAgentLogs("FN-001", true, projectId),
        { initialProps: { projectId: "proj-A" } },
      );

      await waitFor(() => {
        expect(result.current.entries.map((entry) => entry.text)).toEqual(["proj-A-log"]);
        expect(result.current.loading).toBe(false);
      });

      rerender({ projectId: "proj-B" });

      expect(result.current.entries).toEqual([]);
      expect(result.current.loading).toBe(true);

      await act(async () => {
        secondFetch.resolve({
          entries: [{ timestamp: "2026-01-01T00:00:00Z", taskId: "FN-001", text: "proj-B-log", type: "text" as const }],
          total: 1,
          hasMore: false,
        });
        await secondFetch.promise;
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.entries.map((entry) => entry.text)).toEqual(["proj-B-log"]);
      });
    });

    it("clears entries immediately when projectId changes", async () => {
      // Set up mock to return different values based on projectId
      mockFetchAgentLogsWithMeta.mockImplementation((_taskId: string, projectId?: string) => {
        if (projectId === "proj-A") {
          return Promise.resolve({
            entries: [{ timestamp: "2026-01-01T00:00:00Z", taskId: "FN-001", text: "proj-A-log", type: "text" as const }],
            total: 1,
            hasMore: false,
          });
        }
        if (projectId === "proj-B") {
          return Promise.resolve({
            entries: [{ timestamp: "2026-01-01T00:00:00Z", taskId: "FN-001", text: "proj-B-log", type: "text" as const }],
            total: 1,
            hasMore: false,
          });
        }
        return Promise.resolve({ entries: [], total: 0, hasMore: false });
      });

      // Create a hook that switches project
      const { result, rerender } = renderHook(
        ({ projectId }) => useAgentLogs("FN-001", true, projectId),
        { initialProps: { projectId: "proj-A" } },
      );

      // Wait for initial entries to load
      await waitFor(() => {
        expect(result.current.entries).toHaveLength(1);
        expect(result.current.entries[0].text).toBe("proj-A-log");
      });

      // Switch to proj-B
      rerender({ projectId: "proj-B" });

      // Entries should be cleared immediately after project switch
      await waitFor(() => {
        expect(result.current.entries).toHaveLength(0);
      });

      // New fetch should start for proj-B
      await waitFor(() => {
        expect(result.current.entries).toHaveLength(1);
        expect(result.current.entries[0].text).toBe("proj-B-log");
      });
    });

    it("rejects stale SSE events after project switch", async () => {
      // Initial render with proj-A
      mockFetchAgentLogsWithMeta.mockResolvedValue({ entries: [], total: 0, hasMore: false });

      const { result, rerender } = renderHook(
        ({ projectId }) => useAgentLogs("FN-001", true, projectId),
        { initialProps: { projectId: "proj-A" } },
      );

      await waitFor(() => {
        expect(MockEventSource.instances).toHaveLength(1);
      });

      const es = MockEventSource.instances[0];

      // Switch to proj-B
      rerender({ projectId: "proj-B" });

      // Wait for new connection to be established
      await waitFor(() => {
        expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1);
      });

      // Old connection should be closed
      expect(es.close).toHaveBeenCalled();

      // Wait for entries to be cleared
      await waitFor(() => {
        expect(result.current.entries).toHaveLength(0);
      });

      // Emit event on old connection (should be ignored)
      act(() => {
        es._emit("agent:log", {
          timestamp: "2026-01-01T00:01:00Z",
          taskId: "FN-001",
          text: "stale-event",
          type: "text",
        });
      });

      // Stale event should not appear
      expect(result.current.entries.find(e => e.text === "stale-event")).toBeUndefined();
    });

    it("creates new connection with new projectId on project switch", async () => {
      mockFetchAgentLogsWithMeta.mockResolvedValue({ entries: [], total: 0, hasMore: false });

      const { rerender } = renderHook(
        ({ projectId }) => useAgentLogs("FN-001", true, projectId),
        { initialProps: { projectId: "proj-A" } },
      );

      await waitFor(() => {
        expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1);
      });

      const initialCount = MockEventSource.instances.length;

      // Switch to proj-B
      rerender({ projectId: "proj-B" });

      // Wait for new connection
      await waitFor(() => {
        expect(MockEventSource.instances.length).toBeGreaterThan(initialCount);
      });

      // New connection should have correct projectId
      const newConnections = MockEventSource.instances.filter(
        es => es.url.includes("proj-B")
      );
      expect(newConnections.length).toBeGreaterThan(0);
    });
  });
});
