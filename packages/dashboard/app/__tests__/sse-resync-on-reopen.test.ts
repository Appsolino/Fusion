/*
FNXC:DashboardSSE 2026-07-26-15:30:
Invariant coverage for the sse-bus missed-event contract.

The requirement: the bus tears every EventSource down after SSE_HIDDEN_SUSPEND_DELAY_MS hidden (the
mobile page-discard fix) and /api/events has NO replay buffer, so every event emitted during that
window is lost forever. A subscriber that mutates state only from event handlers therefore diverges
permanently from the server. The invariant every subscriber must satisfy is: hidden -> suspend ->
server state changes while suspended -> visible -> reopen CONVERGES the hook on the server's state.

This is asserted as a general invariant, not one repro: three representative hooks exercise the full
suspend/reopen cycle (an approval raised while suspended, a merge landed while suspended, a chat
reply arrived while suspended), and a coverage ratchet asserts that EVERY subscriber hook declares a
resync path (onReconnect) or an explicit reviewed `replaySafe` opt-out, so a new non-resyncing
subscriber cannot be added silently.

Fake timers (the suspend delay is 60s of wall clock) and mocked fetch — no real I/O.
*/
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { MockEventSource } from "../../vitest.setup";
import { __resetSseBus, SSE_HIDDEN_SUSPEND_DELAY_MS } from "../sse-bus";

const fetchApprovalsMock = vi.fn();
const fetchChatSessionsMock = vi.fn();
const apiMock = vi.fn();

vi.mock("../api", () => ({
  fetchApprovals: (...args: unknown[]) => fetchApprovalsMock(...args),
  fetchChatSessions: (...args: unknown[]) => fetchChatSessionsMock(...args),
  api: (...args: unknown[]) => apiMock(...args),
  ApiRequestError: class ApiRequestError extends Error {},
}));

const { useApprovalBanner } = await import("../hooks/useApprovalBanner");
const { useMergeAdvanceNotice } = await import("../hooks/useMergeAdvanceNotice");
const { useChatUnreadBadge } = await import("../hooks/useChatUnreadBadge");

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Advance while feeding the heartbeats a real stream sends, so the 45s heartbeat timeout is not what fires. */
async function advanceWithHeartbeats(ms: number): Promise<void> {
  const STEP_MS = 20_000;
  let remaining = ms;
  while (remaining > STEP_MS) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STEP_MS);
    });
    latestStream()._emit("heartbeat");
    remaining -= STEP_MS;
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(remaining);
  });
}

function latestStream(): MockEventSource {
  const instance = MockEventSource.instances[MockEventSource.instances.length - 1];
  if (!instance) throw new Error("no EventSource opened");
  return instance;
}

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
}

/**
 * The shared suspend/reopen cycle every assertion below runs: open the stream, background the tab
 * long enough to suspend, let the server move on unobserved, then come back.
 */
async function suspendAndReopen(mutateServerWhileSuspended: () => void): Promise<void> {
  latestStream()._emit("open");

  setVisibility("hidden");
  await advanceWithHeartbeats(SSE_HIDDEN_SUSPEND_DELAY_MS);

  mutateServerWhileSuspended();

  setVisibility("visible");
  latestStream()._emit("open");
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  fetchApprovalsMock.mockReset();
  fetchChatSessionsMock.mockReset();
  apiMock.mockReset();
});

afterEach(() => {
  __resetSseBus();
  setVisibility("visible");
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("sse-bus subscribers resync after a hidden-tab suspend", () => {
  it("useApprovalBanner surfaces an approval raised while the tab was suspended", async () => {
    fetchApprovalsMock.mockResolvedValue({ requests: [], total: 0, pendingCount: 0 });

    const { result } = renderHook(() =>
      useApprovalBanner({
        tasks: [],
        currentProjectId: "p-approval",
        gitHubStarPromptShown: true,
        onStarPrompt: () => {},
      }),
    );
    await flush();
    expect(result.current.candidate).toBeNull();

    await suspendAndReopen(() => {
      // The agent raised an approval while the socket was down; its approval:requested event is gone.
      fetchApprovalsMock.mockResolvedValue({
        requests: [
          {
            id: "ar-1",
            status: "pending",
            actionCategory: "shell",
            actionSummary: "rm -rf build",
            agentId: "agent-1",
            createdAt: "2026-07-26T10:00:00.000Z",
            updatedAt: "2026-07-26T10:00:00.000Z",
          },
        ],
        total: 1,
        pendingCount: 1,
      });
    });

    expect(result.current.candidate).toMatchObject({ dedupeKey: "approval:ar-1" });
  });

  it("useApprovalBanner clears a banner whose approval was decided while suspended", async () => {
    fetchApprovalsMock.mockResolvedValue({ requests: [], total: 0, pendingCount: 0 });

    const { result } = renderHook(() =>
      useApprovalBanner({
        tasks: [],
        currentProjectId: "p-approval-decided",
        gitHubStarPromptShown: true,
        onStarPrompt: () => {},
      }),
    );
    await flush();

    // A live event put a banner on screen before the tab was backgrounded.
    latestStream()._emit("approval:requested", { id: "ar-2", updatedAt: "2026-07-26T10:00:00.000Z" });
    await flush();
    expect(result.current.candidate).toMatchObject({ dedupeKey: "approval:ar-2" });

    await suspendAndReopen(() => {
      // Decided from another device while we were disconnected: nothing pending remains.
      fetchApprovalsMock.mockResolvedValue({ requests: [], total: 0, pendingCount: 0 });
    });

    expect(result.current.candidate).toBeNull();
  });

  it("useMergeAdvanceNotice surfaces a merge that landed while the tab was suspended", async () => {
    const behindNotice = {
      taskId: "FN-1",
      integrationBranch: "main",
      refName: "refs/heads/main",
      toSha: "sha-new",
      fromSha: "sha-old",
      advanceMode: "fast-forward",
      succeeded: true,
      advancedAt: "2026-07-26T10:00:00.000Z",
      userCheckout: { worktreePath: "/checkout", dirty: false, untrackedCount: 0 },
    };

    apiMock.mockImplementation((path: string) => {
      if (typeof path === "string" && path.includes("merge-advance-events")) {
        return Promise.resolve({ events: [] });
      }
      return Promise.reject(new Error("no push status"));
    });

    const { result } = renderHook(() => useMergeAdvanceNotice({ projectId: "p-merge" }));
    await flush();
    expect(result.current.notice).toBeUndefined();

    await suspendAndReopen(() => {
      apiMock.mockImplementation((path: string) => {
        if (typeof path === "string" && path.includes("merge-advance-events")) {
          return Promise.resolve({ events: [behindNotice] });
        }
        return Promise.reject(new Error("no push status"));
      });
    });

    expect(result.current.notice).toMatchObject({ toSha: "sha-new" });
  });

  it("useChatUnreadBadge counts a reply that arrived while the tab was suspended", async () => {
    fetchChatSessionsMock.mockResolvedValue({ sessions: [] });

    const { result } = renderHook(() =>
      useChatUnreadBadge("p-chat", { taskView: "board", quickChatOpen: false }),
    );
    await flush();
    expect(result.current.chatHasUnreadResponse).toBe(false);

    await suspendAndReopen(() => {
      fetchChatSessionsMock.mockResolvedValue({
        sessions: [
          {
            id: "s-1",
            agentId: "agent-1",
            // Far in the future relative to the read watermark taken at mount.
            lastMessageAt: "2999-01-01T00:00:00.000Z",
          },
        ],
      });
    });

    expect(result.current.chatHasUnreadResponse).toBe(true);
  });
});

/*
FNXC:DashboardSSE 2026-07-26-15:38:
Coverage ratchet. The regressions this file was written for were all the same shape — a subscriber
added with event handlers and no way back to authoritative state — so per-hook cases alone would keep
letting the NEXT one through. Every hook that calls subscribeSse must declare `onReconnect` or the
explicit `replaySafe` opt-out documented on SseSubscription.
`useAgentLogs.ts` is knowingly absent from the exemptions: if it fails here it needs a resync, not an
exemption.
*/
describe("sse-bus subscriber resync contract (hooks)", () => {
  it("every subscriber hook declares onReconnect or an explicit replaySafe opt-out", () => {
    const hooksDir = join(__dirname, "..", "hooks");
    const offenders: string[] = [];

    for (const file of readdirSync(hooksDir)) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      const source = readFileSync(join(hooksDir, file), "utf8");
      if (!source.includes("subscribeSse(")) continue;
      if (source.includes("onReconnect") || source.includes("replaySafe")) continue;
      offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
