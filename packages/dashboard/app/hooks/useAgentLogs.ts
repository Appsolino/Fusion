import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentLogEntry } from "@fusion/core";
import { fetchAgentLogsWithMeta } from "../api";
import { subscribeSse } from "../sse-bus";
import { recordResumeEvent } from "../utils/resumeInstrumentation";

const INITIAL_LOAD_LIMIT = 100;

/*
FNXC:MobileTabRetention 2026-07-26-10:20:
Mobile browsers (iOS Safari tabs, iOS PWAs, Chrome Android) discard a backgrounded page whose
resident set is large, which the operator sees as a full white-splash reload on return. Every live
log tail must therefore be a bounded ring, never an array that grows for the lifetime of the session:
an agent streaming for an hour otherwise pins tens of MB of log entries per open surface.
500 matches the caps already enforced by useMultiAgentLogs and useDevServerLogs — one number so the
per-surface memory ceiling stays predictable.
*/
export const MAX_LOG_ENTRIES = 500;

/**
 * Keep only the newest `cap` items of a streaming buffer.
 *
 * Whole-list cap: it bounds how many entries are retained, never the content of an individual
 * entry. Newest-wins — a log tail is read from the bottom, so dropping the oldest entries is the
 * only truncation that preserves what the reader is actually looking at.
 *
 * Generic so the agent-detail and command-center streams can share this one implementation instead
 * of each re-deriving the same `slice(-N)` (see AGENTS.md "Reuse Components ... (No Drift)").
 */
export function capLogEntries<T>(entries: T[], cap: number = MAX_LOG_ENTRIES): T[] {
  return entries.length > cap ? entries.slice(-cap) : entries;
}

function getActiveContextKey(taskId: string | null, enabled: boolean, projectId?: string): string | null {
  if (!taskId || !enabled) return null;
  return `${projectId ?? ""}\u0000${taskId}`;
}

/**
 * Hook that manages agent log fetching and live SSE streaming for a task.
 *
 * Features:
 * - **Pagination**: Initial load fetches 100 entries. Use `loadMore()` to fetch older entries.
 * - **Project-context isolation**: Prevents cross-project log bleed via context versioning.
 * - **Live streaming**: SSE events append new entries to the end of the list.
 *
 * **Pagination semantics**:
 * - Entries are returned in chronological order (oldest first) from the API
 * - Entries are stored in chronological order
 * - The UI displays entries in chronological order (oldest first)
 * - `loadMore()` fetches the next 100 older entries and prepends them
 *
 * When `enabled` is true:
 * 1. Fetches recent historical logs via GET /api/tasks/:id/logs?limit=100
 * 2. Opens an EventSource to /api/tasks/:id/logs/stream for live updates
 * 3. Merges historical + live entries in order
 *
 * When `enabled` becomes false or the component unmounts, the EventSource
 * is closed to avoid unnecessary SSE connections.
 *
 * @returns Object with entries, loading, clear, loadMore, hasMore, total
 */
export function useAgentLogs(taskId: string | null, enabled: boolean, projectId?: string) {
  const [entries, setEntries] = useState<AgentLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedContextKey, setLoadedContextKey] = useState<string | null>(null);

  // Refs for state that needs to survive re-renders
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);
  // Sticky "the live tail dropped older entries" flag; see the SSE handler below.
  const trimmedLiveTailRef = useRef(false);

  // Track the project context version to detect stale SSE events after project switches.
  // Incremented whenever projectId changes, invalidating any in-flight SSE handlers.
  const projectContextVersionRef = useRef(0);

  // Track previous values to detect context changes
  const previousTaskIdRef = useRef<string | null>(taskId);
  const previousProjectIdRef = useRef<string | undefined>(projectId);
  const previousEnabledRef = useRef(enabled);

  // Track request version to reject stale fetch completions
  const requestVersionRef = useRef(0);

  // Detect context changes and clear state immediately
  const activeContextKey = getActiveContextKey(taskId, enabled, projectId);
  const contextChanged =
    previousTaskIdRef.current !== taskId ||
    previousProjectIdRef.current !== projectId ||
    previousEnabledRef.current !== enabled;

  if (contextChanged) {
    previousTaskIdRef.current = taskId;
    previousProjectIdRef.current = projectId;
    previousEnabledRef.current = enabled;
    projectContextVersionRef.current++;
    recordResumeEvent({
      view: "useAgentLogs",
      trigger: "project-context-change",
      projectId,
      replayAttempted: false,
      reason: "context-version-bumped",
      detail: { taskId },
    });
    cancelledRef.current = true;

    // Clear entries immediately on context change to prevent stale data visibility
    trimmedLiveTailRef.current = false;
    setEntries([]);
    setLoading(false);
    setHasMore(false);
    setTotal(null);
    setLoadingMore(false);
    setLoadedContextKey(null);

    // Drop existing SSE subscription
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  }

  useEffect(() => {
    if (!taskId || !enabled) {
      // Drop any existing subscription when disabled
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      return;
    }

    // Capture context version at effect start - stale SSE events will be rejected
    const contextVersionAtStart = projectContextVersionRef.current;
    const requestVersion = ++requestVersionRef.current;
    cancelledRef.current = false;

    // Capture taskId and projectId at effect start for comparison
    const currentTaskId = taskId;
    const currentProjectId = projectId;
    const requestContextKey = getActiveContextKey(currentTaskId, true, currentProjectId);

    async function init() {
      if (!currentTaskId) return;

      setLoading(true);
      setLoadingMore(false);
      try {
        const result = await fetchAgentLogsWithMeta(currentTaskId, currentProjectId, { limit: INITIAL_LOAD_LIMIT });

        // Reject stale response: check context version and request version
        if (cancelledRef.current ||
            projectContextVersionRef.current !== contextVersionAtStart ||
            requestVersionRef.current !== requestVersion) {
          return;
        }
        setEntries(result.entries);
        setHasMore(result.hasMore);
        setTotal(result.total);
        setLoadedContextKey(requestContextKey);
      } catch {
        // Reject stale error: check context version and request version
        if (cancelledRef.current ||
            projectContextVersionRef.current !== contextVersionAtStart ||
            requestVersionRef.current !== requestVersion) {
          return;
        }
        setEntries([]);
        setHasMore(false);
        setTotal(null);
        setLoadedContextKey(requestContextKey);
      } finally {
        // Only update loading state if not cancelled and not stale
        if (!cancelledRef.current &&
            projectContextVersionRef.current === contextVersionAtStart &&
            requestVersionRef.current === requestVersion) {
          setLoading(false);
        }
      }

      // Subscribe to the shared per-task log stream
      const query = currentProjectId ? `?projectId=${encodeURIComponent(currentProjectId)}` : "";
      unsubscribeRef.current = subscribeSse(
        `/api/tasks/${currentTaskId}/logs/stream${query}`,
        {
          onOpen: () => {
            recordResumeEvent({
              view: "useAgentLogs",
              trigger: "sse-open",
              projectId: currentProjectId,
              replayAttempted: false,
              sseChannel: `/api/tasks/${currentTaskId}/logs/stream`,
              detail: { taskId: currentTaskId },
            });
          },
          onReconnect: () => {
            recordResumeEvent({
              view: "useAgentLogs",
              trigger: "sse-reconnect",
              projectId: currentProjectId,
              replayAttempted: false,
              sseChannel: `/api/tasks/${currentTaskId}/logs/stream`,
              detail: { taskId: currentTaskId },
            });
          },
          events: {
            "agent:log": (e) => {
              if (cancelledRef.current ||
                  projectContextVersionRef.current !== contextVersionAtStart) {
                return;
              }
              try {
                const entry: AgentLogEntry = JSON.parse(e.data);
                /*
                FNXC:MobileTabRetention 2026-07-26-10:24:
                The live tail is bounded so a long-running agent cannot grow this buffer without
                limit (see MAX_LOG_ENTRIES). The ceiling is `max(MAX_LOG_ENTRIES, prev.length)`:
                streaming holds the buffer at whatever size it has (dropping one oldest entry per
                new line) instead of collapsing a transcript the user deliberately expanded with
                loadMore() straight back down to the cap.
                A trim sets `trimmedLiveTailRef`, which forces `hasMore` on: older entries still
                exist server-side and the viewer's "load older" affordance is the truncation signal,
                so the reader is never shown a silently-clipped tail that looks complete. The flag is
                a ref because the trim decision is only known inside the state updater, and it is
                idempotent so React's double-invoked updaters cannot corrupt it.
                */
                setEntries((prev) => {
                  const limit = Math.max(MAX_LOG_ENTRIES, prev.length);
                  if (prev.length + 1 <= limit) return [...prev, entry];
                  trimmedLiveTailRef.current = true;
                  return [...prev.slice(prev.length + 1 - limit), entry];
                });
                setTotal((prev) => (prev !== null ? prev + 1 : null));
              } catch {
                // skip malformed events
              }
            },
          },
        },
      );
    }

    void init();

    return () => {
      cancelledRef.current = true;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [taskId, enabled, projectId]);

  /**
   * Load more older entries.
   * Fetches the next 100 older entries and prepends them to the existing list.
   */
  const loadMore = useCallback(async () => {
    if (!taskId || loadingMore) return;

    const contextVersionAtStart = projectContextVersionRef.current;
    const currentEntriesCount = entries.length;
    const currentTaskId = taskId;

    setLoadingMore(true);
    try {
      const result = await fetchAgentLogsWithMeta(currentTaskId, projectId, {
        limit: INITIAL_LOAD_LIMIT,
        offset: currentEntriesCount,
      });

      // Reject stale response
      if (cancelledRef.current ||
          projectContextVersionRef.current !== contextVersionAtStart) {
        return;
      }

      // Prepend older entries to the existing list
      setEntries((prev) => [...result.entries, ...prev]);
      setHasMore(result.hasMore);
      setTotal(result.total);
    } catch {
      // Silently fail on load more errors
    } finally {
      setLoadingMore(false);
    }
  }, [taskId, projectId, entries.length, loadingMore]);

  const clear = useCallback(() => {
    trimmedLiveTailRef.current = false;
    setEntries([]);
  }, []);
  const initialContextLoading = Boolean(activeContextKey && loadedContextKey !== activeContextKey);

  return {
    entries,
    loading: loading || initialContextLoading,
    clear,
    loadMore,
    // A trimmed live tail always leaves older entries behind on the server, so the
    // "load older" affordance must stay reachable even when the last fetch said otherwise.
    hasMore: hasMore || trimmedLiveTailRef.current,
    total,
    loadingMore,
  };
}
