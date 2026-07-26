import { useEffect, useState } from "react";

/*
FNXC:BoardPerformance 2026-07-26-09:40:
Mobile browsers (iOS Safari tabs, iOS installed PWAs, Chrome Android) discard a backgrounded page
when it keeps doing work or holds a large resident set; the user then gets a full white-splash reload
on return. A page that never goes idle in the background is one of the strongest discard signals the
OS reads.

Before this module every rendered TaskCard owned its own `window.setInterval` for the live
elapsed-time indicator, so a 60-card board woke the tab 60 times every 30s — including while hidden.
This module collapses that into ONE process-wide ticker with three requirements:
  1. Exactly one interval regardless of subscriber count; zero subscribers means NO timer at all.
  2. The timer only runs while `document.visibilityState === "visible"`. Going hidden stops it, so a
     backgrounded tab is genuinely idle.
  3. Becoming visible ticks IMMEDIATELY, so elapsed-time indicators are never stale on return —
     losing the background ticks must not cost correctness, only background work.

The ticker is a module singleton rather than a React context on purpose: TaskCard is rendered from
Board/Column, DockTaskList, WorktreeGroup, useRightDockController, and dashboard/MainContent. A
singleton covers every one of those surfaces without a provider mount, so no future TaskCard host can
silently fall back to a per-card timer.
*/

/** Cadence of the live elapsed-time indicators on task cards. */
export const LIVE_TIME_INDICATOR_POLL_MS = 30_000;

type TickListener = () => void;

const listeners = new Set<TickListener>();
let intervalId: number | null = null;
let visibilityListenerBound = false;

function isDocumentVisible(): boolean {
  // Non-DOM environments (SSR, plain-node unit tests) are treated as visible so the
  // ticker still behaves normally rather than silently never firing.
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function notifyListeners(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

function startInterval(): void {
  if (intervalId !== null || typeof window === "undefined") {
    return;
  }
  if (listeners.size === 0 || !isDocumentVisible()) {
    return;
  }
  intervalId = window.setInterval(notifyListeners, LIVE_TIME_INDICATOR_POLL_MS);
}

function stopInterval(): void {
  if (intervalId === null || typeof window === "undefined") {
    return;
  }
  window.clearInterval(intervalId);
  intervalId = null;
}

function handleVisibilityChange(): void {
  if (!isDocumentVisible()) {
    stopInterval();
    return;
  }
  // Requirement 3: catch up on return before re-arming, so the first frame after
  // the tab is foregrounded already shows a fresh elapsed time.
  notifyListeners();
  startInterval();
}

/**
 * Subscribes to the shared live-time ticker. Returns an unsubscribe function.
 * The underlying interval and `visibilitychange` listener exist only while at
 * least one subscriber is registered.
 */
export function subscribeLiveTimeTicker(listener: TickListener): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof document !== "undefined" && !visibilityListenerBound) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerBound = true;
  }
  startInterval();

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) {
      return;
    }
    stopInterval();
    if (visibilityListenerBound && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      visibilityListenerBound = false;
    }
  };
}

/** Test-only introspection: whether the shared interval is currently armed. */
export function isLiveTimeTickerRunning(): boolean {
  return intervalId !== null;
}

/** Test-only introspection: current subscriber count. */
export function liveTimeTickerSubscriberCount(): number {
  return listeners.size;
}

/**
 * Returns a "now" timestamp that advances once per {@link LIVE_TIME_INDICATOR_POLL_MS}
 * while the tab is visible.
 *
 * When `enabled` is false the caller does NOT subscribe (no timer work is attributed to it) and the
 * returned value stays frozen at mount time — matching the pre-shared-ticker behavior of cards whose
 * column/status made them ineligible for a live indicator.
 */
export function useLiveTimeTicker(enabled: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) {
      return;
    }
    // Freshen on (re-)subscribe: the shared ticker's cadence is global, so a card
    // mounting mid-interval must not wait up to a full period for its first value.
    setNowMs(Date.now());
    return subscribeLiveTimeTicker(() => setNowMs(Date.now()));
  }, [enabled]);

  return nowMs;
}
