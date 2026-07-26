/*
FNXC:AgentLogHistory 2026-07-26-13:55:
Regression coverage for the agent-log history invariant: a fetched run log is NEVER discarded, only
windowed for rendering, and every entry back to index 0 stays reachable through the UI.

The defect this guards: `fetchAgentRunLogs` is unpaginated (no offset parameter) and AgentDetailView
has no loadMore/hasMore path, so passing the fetched array through `capLogEntries` threw away entries
the client already held — for a 1500-entry run, entries 0..999 including the run's opening prompt —
while a banner claimed "Showing the most recent 500 entries" with no way to retrieve them.

Surface enumeration (AGENTS.md "Fix the Invariant, Not the Repro") — the same fetched-then-discarded
path existed on BOTH agent log surfaces, so both are asserted here:
  - the Logs tab's latest-run fallback (no assigned task),
  - the Runs tab's expanded-run detail,
plus the SSE suspend/reopen cycle: log channels are suspended after ~60s hidden, so each subscription
must define `onReconnect` and refetch authoritative state instead of resuming a tail that skipped
lines.
*/

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { AgentHeartbeatRun } from "../../api";
import type { AgentLogEntry } from "@fusion/core";
import {
  createMockAgent,
  mockFetchAgent,
  mockFetchAgentRunLogs,
  mockFetchAgentRuns,
  mockFetchAgentRunDetail,
  mockSubscribeSse,
  setupAgentDetailMocks,
} from "./AgentDetailView.test-helpers";
import { AgentDetailView } from "../AgentDetailView";

const RUN_LENGTH = 1500;
const WINDOW = 500;

function makeEntries(count: number, offset = 0): AgentLogEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, offset + i)).toISOString(),
    taskId: "agent-run",
    text: `entry-${offset + i}`,
    type: "text" as const,
  }));
}

const ACTIVE_RUN = {
  id: "run-long",
  agentId: "agent-001",
  startedAt: "2024-01-01T00:00:00.000Z",
  endedAt: null,
  status: "active",
} as AgentHeartbeatRun;

function renderedEntryTexts(): string[] {
  const viewer = screen.getByTestId("agent-log-viewer");
  return Array.from(viewer.children).map((child) => child.textContent ?? "");
}

/** Click "Load older" until it disappears, so the window reaches entry 0. */
async function exhaustLoadOlder(testId: string): Promise<number> {
  let clicks = 0;
  while (screen.queryByTestId(`${testId}-load-older`)) {
    fireEvent.click(screen.getByTestId(`${testId}-load-older`));
    clicks++;
    // Guard against an affordance that never terminates rather than looping forever.
    expect(clicks).toBeLessThanOrEqual(10);
    await waitFor(() => expect(renderedEntryTexts().length).toBeGreaterThan(WINDOW * clicks - 1));
  }
  return clicks;
}

describe("AgentDetailView — agent log history is windowed, not discarded", () => {
  beforeEach(() => {
    setupAgentDetailMocks();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/token-usage")) {
        const window = { totalInputTokens: 100, totalCachedTokens: 50, totalCacheWriteTokens: 10, totalOutputTokens: 20, nTasks: 2, hitRatio: 0.33 };
        return new Response(JSON.stringify({ last24h: window, last7d: window, allTime: window }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });

  it("Logs tab: renders a bounded window over a 1500-entry run and pages back to entry 0", async () => {
    mockFetchAgent.mockResolvedValue(createMockAgent({ taskId: undefined, activeRun: ACTIVE_RUN, completedRuns: [] }));
    mockFetchAgentRuns.mockResolvedValue([ACTIVE_RUN]);
    mockFetchAgentRunLogs.mockResolvedValue(makeEntries(RUN_LENGTH));

    render(<AgentDetailView agentId="agent-001" onClose={vi.fn()} addToast={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Logs")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Logs"));

    // The default render is bounded (DOM-size goal of the mobile tab-retention work is preserved)…
    await waitFor(() => expect(screen.getByTestId("agent-log-viewer")).toBeInTheDocument());
    await waitFor(() => expect(renderedEntryTexts()).toHaveLength(WINDOW));
    expect(screen.getByText(`entry-${RUN_LENGTH - 1}`)).toBeInTheDocument();
    expect(screen.queryByText("entry-0")).not.toBeInTheDocument();

    // …but the full array is still held: the header counts all 1500 entries.
    expect(screen.getByText(`${RUN_LENGTH} entries`)).toBeInTheDocument();

    // The retired banner must not come back — it advertised data that no longer existed.
    expect(screen.queryByText(/Showing the most recent/)).not.toBeInTheDocument();

    await exhaustLoadOlder("agent-logs");

    expect(screen.getByText("entry-0")).toBeInTheDocument();
    expect(screen.getByText(`entry-${RUN_LENGTH - 1}`)).toBeInTheDocument();
    expect(renderedEntryTexts()).toHaveLength(RUN_LENGTH);
    // The run was fetched once; paging is purely client-side over data already in hand.
    expect(mockFetchAgentRunLogs).toHaveBeenCalledTimes(1);
  });

  it("Runs tab: an expanded run is windowed and pages back to entry 0", async () => {
    mockFetchAgentRunLogs.mockResolvedValue(makeEntries(RUN_LENGTH));
    mockFetchAgentRunDetail.mockResolvedValue({
      id: "run-002",
      agentId: "agent-001",
      startedAt: "2023-12-31T00:00:00.000Z",
      endedAt: "2023-12-31T00:05:00.000Z",
      status: "completed",
    } as AgentHeartbeatRun);

    render(<AgentDetailView agentId="agent-001" onClose={vi.fn()} addToast={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Runs")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Runs"));

    const findCompletedRunButton = () => screen.getAllByRole("button").find(
      (btn) => btn.getAttribute("aria-label")?.includes("run")
        && btn.getAttribute("aria-label")?.includes("completed"),
    );
    await waitFor(() => expect(findCompletedRunButton()).toBeTruthy());
    fireEvent.click(findCompletedRunButton()!);

    await waitFor(() => expect(screen.getByTestId("agent-log-viewer")).toBeInTheDocument());
    await waitFor(() => expect(renderedEntryTexts()).toHaveLength(WINDOW));
    expect(screen.queryByText("entry-0")).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing the most recent/)).not.toBeInTheDocument();

    await exhaustLoadOlder("agent-run-logs");

    expect(screen.getByText("entry-0")).toBeInTheDocument();
    expect(renderedEntryTexts()).toHaveLength(RUN_LENGTH);
  });

  it("converges after an SSE suspend/reopen cycle without losing lines", async () => {
    mockFetchAgent.mockResolvedValue(createMockAgent({ taskId: undefined, activeRun: ACTIVE_RUN, completedRuns: [] }));
    mockFetchAgentRuns.mockResolvedValue([ACTIVE_RUN]);
    mockFetchAgentRunLogs.mockResolvedValue(makeEntries(RUN_LENGTH));

    render(<AgentDetailView agentId="agent-001" onClose={vi.fn()} addToast={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Logs")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Logs"));
    await waitFor(() => expect(renderedEntryTexts()).toHaveLength(WINDOW));

    const streamUrl = `/api/agents/agent-001/runs/${ACTIVE_RUN.id}/logs/stream`;
    const subscription = mockSubscribeSse.mock.calls.find(([url]) => url === streamUrl);
    expect(subscription, "the latest-run log stream must be subscribed").toBeTruthy();
    const options = subscription![1] as {
      events?: Record<string, (e: MessageEvent) => void>;
      onReconnect?: () => void;
    };

    // A live line while connected appends without collapsing the larger fetched buffer back to 500.
    await act(async () => {
      options.events?.["agent:log"]?.({ data: JSON.stringify(makeEntries(1, RUN_LENGTH)[0]) } as MessageEvent);
    });
    await waitFor(() => expect(screen.getByText(`entry-${RUN_LENGTH}`)).toBeInTheDocument());

    // The suspend window: lines 1501..1504 are emitted while the channel is closed, so the tail
    // never sees them. The reopen must refetch authoritative state rather than resume blind.
    expect(options.onReconnect, "log subscriptions must define onReconnect").toBeTypeOf("function");
    mockFetchAgentRunLogs.mockResolvedValue(makeEntries(RUN_LENGTH + 5));
    await act(async () => {
      options.onReconnect?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText(`entry-${RUN_LENGTH + 4}`)).toBeInTheDocument());
    // Nothing in the gap was lost…
    await waitFor(() => expect(screen.getByText(`entry-${RUN_LENGTH + 1}`)).toBeInTheDocument());
    // …and the operator can still walk back to the run's first entry after the heal.
    await exhaustLoadOlder("agent-logs");
    expect(screen.getByText("entry-0")).toBeInTheDocument();
  });
});
