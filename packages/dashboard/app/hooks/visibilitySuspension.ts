import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * FNXC:MobileTabRetention 2026-07-26-10:05:
 * Mobile browsers (iOS Safari tabs, iOS installed PWAs, Chrome Android) discard a backgrounded page
 * when it keeps doing work — a page whose timers keep issuing network requests never registers as idle
 * and is a prime reclaim candidate, which is why returning to Fusion after a few minutes produced a
 * full white-splash reload. `useVisibilityAwarePoll` is the ONE shared gate every dashboard polling loop
 * must use: the interval is torn down entirely while `document.visibilityState === "hidden"` (not merely
 * skipped, so the page holds no armed timer at all), and on the hidden -> visible transition it fires
 * exactly one immediate refresh before re-arming, so the operator still sees fresh data on return.
 *
 * Do not add a second visibility pattern — AGENTS.md requires reusing this helper. If a hook already owns
 * its own `visibilitychange` refresh listener, pass `refreshOnVisible: false` so the refresh is not doubled.
 */

/*
FNXC:MobileTabRetention 2026-07-26-14:20:
Visible-edge stampede control. The first cut of this helper fired `refreshOnVisible` SYNCHRONOUSLY in every
subscriber on the single `visibilitychange` event, and re-armed every interval at the same instant. On a board
with ~25 in-viewport cards that is ~35 simultaneous requests (one runtime-fallback fetch per card plus the
singleton pollers) against a browser cap of 6 concurrent HTTP/1.1 connections per origin, queued behind a
waking mobile radio — and `sse-bus.reopenVisibleChannels()` is competing for a connection on that same edge
(`app/api/event-source.ts` documents per-origin exhaustion as a real failure mode here). Before the mobile
work each poller owned an independently drifted interval, so no synchronized burst existed; the fix
reintroduced a thundering herd on exactly the restore path it was optimizing.

Resolution: a DETERMINISTIC stagger derived from subscription order (no randomness, so it is testable).
- Subscribers registered as `priority: "background"` (the default) take a slot from a module-level
  insertion-ordered registry; slot N resumes at `(N % SLOTS) * STEP_MS`, so at most ceil(total/SLOTS)
  subscribers hit the network in any one step and slot 0 stays synchronous (a lone poller is unchanged).
- `priority: "critical"` opts out of the registry entirely and resumes synchronously, for data the operator
  is directly looking at. It is opt-in rather than default so the safe behavior is the default.
- The INTERVAL is armed inside the staggered resume, not on the edge, so the offsets persist and the pollers
  stay drifted apart instead of re-synchronizing and re-bursting one interval later.
- The pending stagger timer is cleared by `stop()`, so a tab that is backgrounded again mid-window issues no
  request — the "hidden page does no work" invariant is preserved, not weakened.

The `dedupe()` helper in `app/api/dedupe.ts` deliberately does NOT cover this: it collapses concurrent calls
sharing one cache key, whereas the 25 badge requests carry 25 distinct task ids, so there is nothing to
collapse. Modulo wrap keeps the spread bounded by VISIBLE_EDGE_STAGGER_WINDOW_MS regardless of subscriber
count; user-visible staleness on return is therefore capped at ~3s for ancillary data only.

Board task data is NOT affected: `useTasks` owns its own `visibilitychange` refresh listener and never routes
through this helper, so the operator's primary data is still refreshed immediately on return.
*/
const VISIBLE_EDGE_STAGGER_STEP_MS = 150;
const VISIBLE_EDGE_STAGGER_WINDOW_MS = 3_000;
const VISIBLE_EDGE_STAGGER_SLOTS = Math.max(
  1,
  Math.round(VISIBLE_EDGE_STAGGER_WINDOW_MS / VISIBLE_EDGE_STAGGER_STEP_MS),
);

/** Insertion-ordered registry of background subscribers; membership position is the stagger slot. */
const staggeredVisibleEdgeSubscribers = new Set<object>();

/** Slot index is recomputed at each visible edge so unmounted subscribers never leave holes in the schedule. */
function visibleEdgeDelayMs(token: object): number {
  let index = 0;
  for (const registered of staggeredVisibleEdgeSubscribers) {
    if (registered === token) {
      break;
    }
    index += 1;
  }
  return (index % VISIBLE_EDGE_STAGGER_SLOTS) * VISIBLE_EDGE_STAGGER_STEP_MS;
}

/**
 * Test-only escape hatch: clears the module-level stagger registry so one test's mounted subscribers cannot
 * shift another test's slot assignments. No-op outside the test build.
 */
export function __resetVisibleEdgeStaggerRegistryForTests(): void {
  if (import.meta.env.MODE !== "test") return;
  staggeredVisibleEdgeSubscribers.clear();
}

export type VisibilityPollPriority = "critical" | "background";

export function useVisibilityAwarePoll(
  callback: () => void,
  intervalMs: number,
  options: { enabled?: boolean; refreshOnVisible?: boolean; priority?: VisibilityPollPriority } = {},
): void {
  const { enabled = true, refreshOnVisible = true, priority = "background" } = options;
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const tick = () => callbackRef.current();

    // Non-DOM environments (SSR/unit harnesses without `document`) keep the plain interval.
    if (typeof document === "undefined") {
      const id = setInterval(tick, intervalMs);
      return () => clearInterval(id);
    }

    // Stagger identity for this subscriber. Critical subscribers stay out of the registry so they never
    // take a slot and always resume synchronously.
    const staggerToken = {};
    if (priority !== "critical") {
      staggeredVisibleEdgeSubscribers.add(staggerToken);
    }

    let timer: ReturnType<typeof setInterval> | null = null;
    let staggerTimer: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      if (timer === null) {
        timer = setInterval(tick, intervalMs);
      }
    };
    const stop = () => {
      if (staggerTimer !== null) {
        clearTimeout(staggerTimer);
        staggerTimer = null;
      }
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    // Refresh once and re-arm the interval FROM the staggered instant, so subscribers stay drifted apart
    // instead of re-synchronizing one interval after the edge.
    const resume = () => {
      staggerTimer = null;
      if (refreshOnVisible) {
        tick();
      }
      start();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      // Both timers null is the hidden -> visible edge (or a mount that happened while hidden). The
      // `staggerTimer` half of the guard also makes a duplicate visibilitychange during the stagger window
      // a no-op rather than a second queued refresh.
      if (timer === null && staggerTimer === null) {
        const delayMs = priority === "critical" ? 0 : visibleEdgeDelayMs(staggerToken);
        if (delayMs === 0) {
          resume();
        } else {
          staggerTimer = setTimeout(resume, delayMs);
        }
      }
    };

    if (document.visibilityState !== "hidden") {
      start();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stop();
      staggeredVisibleEdgeSubscribers.delete(staggerToken);
    };
  }, [enabled, intervalMs, refreshOnVisible, priority]);
}

let lastHiddenAt: number | null = null;
let lastVisibleAt: number | null = null;

const SUSPENSION_ERROR_PATTERNS = [
  "load failed",
  "failed to fetch",
  "networkerror when attempting to fetch resource.",
  "connection aborted",
  "connection closed unexpectedly",
  "network error",
];

export function isLikelyTabSuspensionError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return SUSPENSION_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function isVisibilityResumeError(errorMessage: string, wasRecentlyHiddenResult: boolean): boolean {
  return wasRecentlyHiddenResult && isLikelyTabSuspensionError(errorMessage);
}

export function lastVisibilityTransition(): { hiddenAt: number | null; visibleAt: number | null } {
  return {
    hiddenAt: lastHiddenAt,
    visibleAt: lastVisibleAt,
  };
}

/**
 * Tracks tab visibility transitions and suspension-recovery signals.
 * - `onBecameVisible` subscriptions fire only when transitioning hidden -> visible.
 * - `lastVisibilityTransition` exposes last hidden/visible timestamps for testing and reconnect logic.
 */
export function useTabVisibilitySuspension() {
  const lastHiddenAtRef = useRef<number | null>(lastHiddenAt);
  const lastVisibleAtRef = useRef<number | null>(lastVisibleAt);
  const visibilityHandlersRef = useRef(new Set<() => void>());

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    let previousVisibilityState = document.visibilityState;

    const handleVisibilityChange = () => {
      const now = Date.now();
      const currentVisibilityState = document.visibilityState;
      if (currentVisibilityState === "hidden") {
        lastHiddenAtRef.current = now;
        lastHiddenAt = now;
      }
      if (currentVisibilityState === "visible") {
        lastVisibleAtRef.current = now;
        lastVisibleAt = now;
        if (previousVisibilityState === "hidden") {
          for (const handler of visibilityHandlersRef.current) {
            handler();
          }
        }
      }
      previousVisibilityState = currentVisibilityState;
    };

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const isHiddenNow = useCallback(() => typeof document !== "undefined" && document.visibilityState === "hidden", []);

  const wasRecentlyHidden = useCallback((windowMs = 5000): boolean => {
    const hiddenAt = lastHiddenAtRef.current;
    if (hiddenAt === null) {
      return false;
    }
    const now = Date.now();
    if (isHiddenNow()) {
      return now - hiddenAt <= windowMs;
    }

    const visibleAt = lastVisibleAtRef.current;
    if (visibleAt === null || visibleAt < hiddenAt) {
      return false;
    }
    return now - visibleAt <= windowMs;
  }, [isHiddenNow]);

  const onBecameVisible = useCallback((handler: () => void) => {
    visibilityHandlersRef.current.add(handler);
    return () => {
      visibilityHandlersRef.current.delete(handler);
    };
  }, []);

  return useMemo(() => ({
    isHiddenNow,
    wasRecentlyHidden,
    onBecameVisible,
  }), [isHiddenNow, onBecameVisible, wasRecentlyHidden]);
}
