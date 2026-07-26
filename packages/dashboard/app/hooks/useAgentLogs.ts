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

/*
FNXC:AgentLogResync 2026-07-26-14:05:
`/api/tasks/:id/logs/stream` is a LIVE-ONLY channel: it pipes `agent:log` events as they happen and
sends nothing but `: connected` on open — no ring buffer, no Last-Event-ID replay. Every line the
server emitted while the channel was down is therefore unrecoverable from the socket, and after the
hidden-tab SSE suspend (SSE_HIDDEN_SUSPEND_DELAY_MS) that window is minutes long on desktop as well
as mobile. Before this, `onReconnect` only recorded an instrumentation event, so the rendered list
silently skipped those lines while still LOOKING contiguous.
On reconnect the hook now refetches the authoritative newest page over the existing REST path
(`fetchAgentLogsWithMeta`, offset 0) and splices it onto the buffer. Where the splice cannot be
proven — the missed window is larger than one page, so the refetched page shares no entries with what
the reader already has — the buffer is resynced to the authoritative page behind a VISIBLE gap
marker. A visible gap plus a working "load older" is always preferable to implied continuity the
client cannot guarantee.
*/
const LOG_GAP_MARKER_FLAG = "__fusionLogGap";

export const LOG_GAP_MARKER_TEXT =
  "Log stream reconnected. Output emitted while this view was disconnected is not shown above; use \"load older\" to fetch it.";

/** A synthetic, client-only entry marking a proven discontinuity in the rendered log. */
export type AgentLogGapMarker = AgentLogEntry & { readonly [LOG_GAP_MARKER_FLAG]: true };

/**
 * True for the synthetic gap marker. Renderers use it to style the break; the hook uses it to keep
 * the marker out of every count that maps onto server-side offsets.
 */
export function isLogGapMarker(entry: AgentLogEntry): boolean {
  return (entry as Partial<AgentLogGapMarker>)[LOG_GAP_MARKER_FLAG] === true;
}

function createLogGapMarker(taskId: string, timestamp: string): AgentLogGapMarker {
  return { timestamp, taskId, text: LOG_GAP_MARKER_TEXT, type: "status", [LOG_GAP_MARKER_FLAG]: true };
}

/**
 * Identity of a log entry for de-duplication. Agent log rows carry no server id, so the full
 * persisted content is the only available key; `timestamp` alone is not unique (streamed deltas
 * share a millisecond).
 *
 * FNXC:DashboardLogs 2026-07-26-10:15:
 * The separator MUST stay written as the `\u0000` escape, never as a raw NUL byte in the source.
 * A literal NUL makes git classify this file as binary (`git diff` prints "Bin", so the file becomes
 * undiffable and unreviewable) and makes plain `grep` skip it entirely — both were observed here.
 * The runtime value is identical; only the on-disk encoding differs.
 */
function logEntryKey(entry: AgentLogEntry): string {
  return [entry.timestamp, entry.type, entry.text, entry.detail ?? "", entry.agent ?? ""].join("\u0000");
}

/**
 * Length of the longest suffix of `prev` that is also a prefix of `next`, i.e. how much of `next`
 * the caller already holds. 0 means the two windows do not provably touch.
 *
 * The LARGEST such overlap is chosen deliberately: with repeated identical lines several alignments
 * can match, and the largest one is the only choice that cannot duplicate entries (it can at worst
 * treat a repeat as already-held, which the next event corrects).
 */
export function findLogWindowOverlap(prev: AgentLogEntry[], next: AgentLogEntry[]): number {
  const max = Math.min(prev.length, next.length);
  if (max === 0) return 0;
  const prevKeys = prev.slice(prev.length - max).map(logEntryKey);
  const nextKeys = next.slice(0, max).map(logEntryKey);
  for (let k = max; k > 0; k--) {
    let matches = true;
    for (let i = 0; i < k; i++) {
      if (prevKeys[max - k + i] !== nextKeys[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return k;
  }
  return 0;
}

/** Append `next` after `prev`, dropping the leading entries of `next` that `prev` already holds. */
function appendWithoutDuplicates(prev: AgentLogEntry[], next: AgentLogEntry[]): AgentLogEntry[] {
  if (next.length === 0) return prev;
  if (prev.length === 0) return next;
  const overlap = findLogWindowOverlap(prev, next);
  return [...prev.slice(0, prev.length - overlap), ...next];
}

/*
FNXC:AgentLogResync 2026-07-26-14:12:
Reconnect reconciliation. Inputs: the buffer as rendered (`prev`, which may already carry a leading
gap marker), the authoritative newest page (`fresh`), and any live events that arrived while the
refetch was in flight (`pending`, held out of `prev` so the merge sees a stable snapshot).

Overlap case: the reader's buffer and the refetched page share entries, so the missed lines are
exactly `fresh`'s non-overlapping tail — splice and keep the whole paged-back history.
No-overlap case: more than one page was missed. The unreconcilable older prefix is DROPPED and a gap
marker is put at the head rather than concatenated blindly, because keeping it would (a) imply a
continuity that does not exist and (b) break `loadMore`'s offset arithmetic, which requires the
buffer to stay a contiguous suffix of the server log. The dropped prefix is re-fetchable: the first
"load older" pulls the true entries below the gap and the marker is retired.

Cap: the merged buffer honours the same ring ceiling as the live tail (`max(MAX_LOG_ENTRIES,
prev.length)`) so a resync cannot blow past the memory budget that the mobile-retention work exists
to enforce. The marker is re-attached after the cap, so a trim can never silently swallow the very
signal that says entries are missing.
*/
export function reconcileReconnectedEntries(
  prev: AgentLogEntry[],
  fresh: AgentLogEntry[],
  pending: AgentLogEntry[],
  taskId: string,
): { entries: AgentLogEntry[]; trimmed: boolean; gapInserted: boolean } {
  const hadGapMarker = prev.length > 0 && isLogGapMarker(prev[0]);
  const previousGapMarker = hadGapMarker ? (prev[0] as AgentLogGapMarker) : null;
  const prevReal = hadGapMarker ? prev.slice(1) : prev;

  let gapMarker: AgentLogGapMarker | null = previousGapMarker;
  let gapInserted = false;
  let merged: AgentLogEntry[];

  if (fresh.length === 0) {
    merged = prevReal;
  } else if (prevReal.length === 0) {
    merged = fresh;
  } else {
    const overlap = findLogWindowOverlap(prevReal, fresh);
    if (overlap > 0) {
      merged = [...prevReal.slice(0, prevReal.length - overlap), ...fresh];
    } else {
      merged = fresh;
      gapMarker = createLogGapMarker(taskId, fresh[0]?.timestamp ?? new Date(0).toISOString());
      gapInserted = true;
    }
  }

  merged = appendWithoutDuplicates(merged, pending);

  const limit = Math.max(MAX_LOG_ENTRIES, prev.length);
  const trimmed = merged.length > limit;
  if (trimmed) merged = merged.slice(merged.length - limit);

  return {
    entries: gapMarker ? [gapMarker, ...merged] : merged,
    trimmed,
    gapInserted,
  };
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
 * **Reconnect semantics**: the stream replays nothing on open, so every reconnect (SSE error,
 * heartbeat timeout, or the hidden-tab suspend/resume) refetches the authoritative newest page and
 * reconciles it with the buffer. Where reconciliation cannot be proven, a gap marker is rendered
 * (`isLogGapMarker`) rather than implying continuity.
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
  /*
  FNXC:AgentLogPaging 2026-07-26-14:20:
  "The live tail dropped older entries" flag; see the SSE handler below. It is sticky ONLY until
  paging proves otherwise — a previous version cleared it only on clear()/context switch, so once the
  tail had trimmed, `hasMore` stayed true even after the reader paged all the way back to entry 0.
  The "load older" control then rendered forever and every further click fetched past the end and
  changed nothing, leaving the reader unable to tell "this is the beginning" from "this is broken".
  Any authoritative fetch that reports `hasMore:false` proves the buffer now reaches entry 0
  (server-side `hasMore = total > offset + returned`), so that response clears the flag.
  */
  const trimmedLiveTailRef = useRef(false);
  // A reconnect refetch is in flight; live events are parked in pendingLiveRef so the merge sees a
  // stable `prev` snapshot and cannot duplicate or drop lines that race the fetch.
  const resyncInFlightRef = useRef(false);
  const pendingLiveRef = useRef<AgentLogEntry[]>([]);

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
    resyncInFlightRef.current = false;
    pendingLiveRef.current = [];
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

    const isStale = () =>
      cancelledRef.current || projectContextVersionRef.current !== contextVersionAtStart;

    /*
    FNXC:AgentLogResync 2026-07-26-14:26:
    Reconnect handler. The log stream replays nothing, so recovery has to come from the REST path.
    Refetch the newest page at offset 0 and reconcile it with what the reader already holds; a single
    resync at a time (a burst of reconnects must not stack refetches). Live events that land while
    the fetch is in flight are parked, then appended after the merge, so the reconnect window cannot
    duplicate or swallow them. If the refetch itself fails the buffer is left alone and the parked
    events are flushed — a degraded live tail is still better than dropping lines on the floor.
    */
    async function resyncFromServer() {
      if (!currentTaskId || resyncInFlightRef.current || isStale()) return;
      const resyncTaskId: string = currentTaskId;
      resyncInFlightRef.current = true;
      pendingLiveRef.current = [];
      let reconciled = false;
      try {
        const result = await fetchAgentLogsWithMeta(resyncTaskId, currentProjectId, {
          limit: INITIAL_LOAD_LIMIT,
        });
        if (isStale()) return;

        const pending = pendingLiveRef.current;
        pendingLiveRef.current = [];
        reconciled = true;
        setEntries((prev) => {
          const outcome = reconcileReconnectedEntries(prev, result.entries, pending, resyncTaskId);
          if (outcome.trimmed) trimmedLiveTailRef.current = true;
          return outcome.entries;
        });
        setTotal(result.total);
        setHasMore(result.hasMore);
        // An offset-0 page reporting hasMore:false means the whole log fits in the page we just
        // merged, so nothing older is left behind — see the trimmedLiveTailRef note above.
        if (!result.hasMore) trimmedLiveTailRef.current = false;
      } catch {
        // Fall through: the live tail keeps running and the next reconnect retries the resync.
      } finally {
        resyncInFlightRef.current = false;
        if (!reconciled && !isStale()) {
          const pending = pendingLiveRef.current;
          pendingLiveRef.current = [];
          if (pending.length > 0) {
            setEntries((prev) => appendWithoutDuplicates(prev, pending));
          }
        }
      }
    }

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
              replayAttempted: true,
              reason: "refetch-authoritative-log-page",
              sseChannel: `/api/tasks/${currentTaskId}/logs/stream`,
              detail: { taskId: currentTaskId },
            });
            void resyncFromServer();
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
                FNXC:AgentLogResync 2026-07-26-14:32:
                While a reconnect refetch is in flight the buffer must not move: park the event and
                let the reconciliation append it after the authoritative page (deduped), otherwise a
                line that is in both the page and the live stream would render twice — or, if the
                merge ran against a moved buffer, be lost. `total` is left alone here because the
                resync sets the authoritative count.
                */
                if (resyncInFlightRef.current) {
                  pendingLiveRef.current.push(entry);
                  return;
                }
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

  /*
  FNXC:AgentLogPaging 2026-07-26-15:22:
  The reconnect gap marker is a client-only row and always sits at index 0, so one count keeps every
  server-offset calculation honest. Derived as a number rather than from the array so `loadMore`'s
  identity churns no more often than it did before the marker existed (once per buffer-length
  change), not on every streamed line.
  */
  const gapMarkerCount = entries.length > 0 && isLogGapMarker(entries[0]) ? 1 : 0;

  /**
   * Load more older entries.
   * Fetches the next 100 older entries and prepends them to the existing list.
   */
  const loadMore = useCallback(async () => {
    if (!taskId || loadingMore) return;

    const contextVersionAtStart = projectContextVersionRef.current;
    /*
    FNXC:AgentLogPaging 2026-07-26-14:38:
    The server offset counts back from the newest entry, so it must be the number of REAL entries
    held. A synthetic gap marker is client-only and would shift the whole page by one, re-fetching an
    entry the reader already has and leaving a one-entry hole below it.
    */
    const currentEntriesCount = entries.length - gapMarkerCount;
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

      /*
      FNXC:AgentLogPaging 2026-07-26-14:41:
      Prepend older entries. Those entries are exactly the ones immediately below the buffer, so a
      gap marker at the head is now closed by real data and must be retired; a `hasMore:false`
      response also retires it because the server has proven nothing older exists. Leaving a stale
      marker in place would claim a discontinuity that the page just filled.
      */
      const retireGapMarker = result.entries.length > 0 || !result.hasMore;
      setEntries((prev) => {
        const base = retireGapMarker ? prev.filter((entry) => !isLogGapMarker(entry)) : prev;
        return [...result.entries, ...base];
      });
      setHasMore(result.hasMore);
      setTotal(result.total);
      // Paging reached entry 0: the buffer is contiguous back to the beginning, so the live-tail
      // trim no longer implies anything older remains.
      if (!result.hasMore) trimmedLiveTailRef.current = false;
    } catch {
      // Silently fail on load more errors
    } finally {
      setLoadingMore(false);
    }
  }, [taskId, projectId, entries.length, gapMarkerCount, loadingMore]);

  const clear = useCallback(() => {
    trimmedLiveTailRef.current = false;
    pendingLiveRef.current = [];
    setEntries([]);
  }, []);
  const initialContextLoading = Boolean(activeContextKey && loadedContextKey !== activeContextKey);

  return {
    entries,
    loading: loading || initialContextLoading,
    clear,
    loadMore,
    /*
    FNXC:AgentLogPaging 2026-07-26-14:44:
    A trimmed live tail, or a reconnect gap marker at the head, means older entries are still on the
    server, so the "load older" affordance must stay reachable even when the last fetch said
    otherwise. Both signals are retired by the paging response that proves the buffer reaches entry 0
    — `hasMore` is now true iff older entries actually remain.
    */
    hasMore: hasMore || trimmedLiveTailRef.current || gapMarkerCount > 0,
    total,
    loadingMore,
  };
}
