/*
FNXC:DashboardSSE 2026-07-26-10:55:
Regression coverage for the hidden-tab SSE suspend. The requirement it guards: a backgrounded mobile
tab must schedule NO SSE work (no open EventSource, no keepalive interval, no heartbeat reconnect)
once it has been hidden past the grace delay, because that background work is a primary OS/browser
page-discard signal and the discard is what the operator sees as a white-splash reload. It also pins
the bfcache requirement that no `beforeunload` listener is registered.
Fake timers only — the grace delay is 60s of wall clock.
*/
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { MockEventSource } from "../../vitest.setup";
import {
  subscribeSse,
  __resetSseBus,
  __sseBusChannelState,
  SSE_HIDDEN_SUSPEND_DELAY_MS,
} from "../sse-bus";

const URL_A = "/api/events?projectId=suspend-test";

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * Advance `ms` while feeding the server heartbeats a real /api/events stream would send, so these
 * assertions isolate the suspend behavior instead of tripping the unrelated 45s heartbeat timeout.
 */
function advanceWithHeartbeats(ms: number, es: MockEventSource): void {
  const STEP_MS = 20_000;
  let remaining = ms;
  while (remaining > STEP_MS) {
    vi.advanceTimersByTime(STEP_MS);
    es._emit("heartbeat");
    remaining -= STEP_MS;
  }
  vi.advanceTimersByTime(remaining);
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  __resetSseBus();
  setVisibility("visible");
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("sse-bus hidden-tab suspend", () => {
  it("closes channels after the grace period while the tab stays hidden", () => {
    subscribeSse(URL_A, { events: { "task:updated": () => {} } });
    const es = MockEventSource.instances[0]!;
    expect(__sseBusChannelState(URL_A)).toMatchObject({ suspended: false, hasEventSource: true });

    setVisibility("hidden");
    // Still connected during the grace window.
    advanceWithHeartbeats(SSE_HIDDEN_SUSPEND_DELAY_MS - 1, es);
    expect(__sseBusChannelState(URL_A)).toMatchObject({ suspended: false, hasEventSource: true });
    expect(es.close).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(es.close).toHaveBeenCalled();
    expect(__sseBusChannelState(URL_A)).toMatchObject({
      suspended: true,
      closed: false,
      hasEventSource: false,
    });
  });

  it("stops the keepalive interval while suspended so nothing fires when hidden", () => {
    subscribeSse(URL_A, {});
    const es = MockEventSource.instances[0]!;
    expect(__sseBusChannelState(URL_A)?.hasKeepaliveTimer).toBe(true);

    setVisibility("hidden");
    advanceWithHeartbeats(SSE_HIDDEN_SUSPEND_DELAY_MS, es);

    expect(__sseBusChannelState(URL_A)?.hasKeepaliveTimer).toBe(false);

    // A long hidden stretch must not resurrect the socket via heartbeat/reconnect timers.
    const instanceCount = MockEventSource.instances.length;
    vi.advanceTimersByTime(10 * SSE_HIDDEN_SUSPEND_DELAY_MS);
    expect(MockEventSource.instances).toHaveLength(instanceCount);
    expect(__sseBusChannelState(URL_A)?.hasEventSource).toBe(false);
  });

  it("does not close when the tab becomes visible before the grace period expires", () => {
    subscribeSse(URL_A, {});
    const es = MockEventSource.instances[0]!;

    setVisibility("hidden");
    advanceWithHeartbeats(SSE_HIDDEN_SUSPEND_DELAY_MS / 2, es);
    setVisibility("visible");
    advanceWithHeartbeats(SSE_HIDDEN_SUSPEND_DELAY_MS * 2, es);

    expect(es.close).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(1);
    expect(__sseBusChannelState(URL_A)).toMatchObject({ suspended: false, hasEventSource: true });
  });

  it("reopens suspended channels on visible and signals subscribers to resync", () => {
    const onReconnect = vi.fn();
    subscribeSse(URL_A, { events: { "task:updated": () => {} }, onReconnect });
    // The real EventSource fires `open` on connect; the mock does not, and `hasOpenedOnce` is what
    // turns the post-resume open into an onReconnect resync signal.
    MockEventSource.instances[0]!._emit("open");
    expect(onReconnect).not.toHaveBeenCalled();

    setVisibility("hidden");
    advanceWithHeartbeats(SSE_HIDDEN_SUSPEND_DELAY_MS, MockEventSource.instances[0]!);
    expect(__sseBusChannelState(URL_A)?.suspended).toBe(true);

    setVisibility("visible");

    expect(MockEventSource.instances).toHaveLength(2);
    expect(__sseBusChannelState(URL_A)).toMatchObject({
      suspended: false,
      hasEventSource: true,
      hasKeepaliveTimer: true,
    });

    // Events missed while suspended are recovered by the reconnect resync signal.
    const reopened = MockEventSource.instances[1]!;
    reopened._emit("open");
    expect(onReconnect).toHaveBeenCalled();
  });

  it("delivers events again on the reopened stream", () => {
    const received: unknown[] = [];
    subscribeSse(URL_A, { events: { "task:updated": (e) => received.push(JSON.parse(e.data)) } });

    setVisibility("hidden");
    advanceWithHeartbeats(SSE_HIDDEN_SUSPEND_DELAY_MS, MockEventSource.instances[0]!);
    setVisibility("visible");

    const reopened = MockEventSource.instances[1]!;
    reopened._emit("task:updated", { id: "t-9" });

    expect(received).toEqual([{ id: "t-9" }]);
  });

  it("releases the suspend on a bfcache pageshow that arrives without a visibilitychange", () => {
    subscribeSse(URL_A, {});

    setVisibility("hidden");
    advanceWithHeartbeats(SSE_HIDDEN_SUSPEND_DELAY_MS, MockEventSource.instances[0]!);
    expect(__sseBusChannelState(URL_A)?.suspended).toBe(true);

    // Restored from bfcache: the page is visible again but no visibilitychange was delivered.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));

    expect(__sseBusChannelState(URL_A)).toMatchObject({ suspended: false, hasEventSource: true });
  });

  it("registers no beforeunload listener on either EventSource path (bfcache eligibility)", async () => {
    const spy = vi.spyOn(window, "addEventListener");
    try {
      vi.resetModules();
      await import("../sse-bus");
      await import("../api/event-source");
      const types = spy.mock.calls.map(([type]) => type);
      expect(types).not.toContain("beforeunload");
      expect(types).toContain("pagehide");
    } finally {
      spy.mockRestore();
      vi.resetModules();
    }
  });
});
