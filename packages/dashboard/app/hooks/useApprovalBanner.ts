/*
FNXC:ApprovalBanner 2026-06-24-00:00:
Approval-notification banner dedupe/dismiss state machine, driven by task:updated and approval:requested SSE events. Also fires the first-completed-task GitHub-star prompt. Extracted from AppInner.

FNXC:ApprovalBanner 2026-06-24-00:00:
Stale-closure / effect-identity hazard: the per-`tasks` ref-sync effect rebuilds the status + seen-key maps on every tasks change, and the dismissal-timestamp comparison (`updatedAtMs <= dismissedAt`) suppresses re-trigger. Preserve both exactly when touching this hook (see docs/solutions ui-bugs/skill-autocomplete-highlight-reset-on-swr-revalidation and logic-errors/queued-chat-message-flush-trusts-stale-isgenerating).

FNXC:ApprovalBanner 2026-06-26-00:00:
The mailbox approval banner represents only real ApprovalRequest rows delivered by approval:requested SSE with approval:<id> dedupe keys. Task awaiting-approval is a plan-approval lifecycle state surfaced on the triage board and must not create an Open Mailbox banner or refresh mailbox counts.
*/

import { useCallback, useEffect, useRef, useState } from "react";
import type { Task } from "@fusion/core";
import { fetchApprovals } from "../api";
import { subscribeSse } from "../sse-bus";
import {
  type ApprovalBannerCandidate,
  didEnterDone,
  loadApprovalBannerDismissals,
  parseDateMs,
  persistApprovalBannerDismissals,
} from "../utils/appLifecycle";

export interface UseApprovalBannerOptions {
  tasks: Task[];
  currentProjectId: string | undefined;
  gitHubStarPromptShown: boolean;
  /** Invoked when a task first transitions to done (drives the GitHub-star prompt). */
  onStarPrompt: () => void;
}

export interface UseApprovalBannerResult {
  candidate: ApprovalBannerCandidate | null;
  dismissApproval: (candidate: ApprovalBannerCandidate) => void;
}

export function useApprovalBanner({
  tasks,
  currentProjectId,
  gitHubStarPromptShown,
  onStarPrompt,
}: UseApprovalBannerOptions): UseApprovalBannerResult {
  const [candidate, setCandidate] = useState<ApprovalBannerCandidate | null>(null);
  const taskStatusByIdRef = useRef<Map<string, string | undefined>>(new Map());
  const seenApprovalKeysRef = useRef<Set<string>>(new Set());
  const approvalDismissalsRef = useRef<Map<string, number>>(loadApprovalBannerDismissals());

  useEffect(() => {
    const next = new Map<string, string | undefined>();
    const nextSeen = new Set<string>();
    for (const task of tasks) {
      next.set(task.id, task.status);
    }
    taskStatusByIdRef.current = next;
    seenApprovalKeysRef.current = nextSeen;
  }, [tasks]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (currentProjectId) {
      params.set("projectId", currentProjectId);
    }
    const query = params.size > 0 ? `?${params.toString()}` : "";

    const triggerApprovalBanner = (next: ApprovalBannerCandidate) => {
      const dismissedAt = approvalDismissalsRef.current.get(next.dedupeKey);
      if (dismissedAt !== undefined && next.updatedAtMs <= dismissedAt) {
        return;
      }
      setCandidate(next);
    };

    let disposed = false;

    /*
    FNXC:ApprovalBanner 2026-07-26-14:20:
    Missed-event recovery. The banner used to exist ONLY as a function of the `approval:requested`
    event, with no refetch of any kind. Every SSE gap — an error reconnect, and since the mobile
    hidden-tab suspend a routine backgrounded tab — therefore dropped approvals permanently: the
    operator was never shown the request and the requesting agent blocked indefinitely on a decision
    that could not be made. On every reopen, re-read the authoritative pending list and converge:
    surface the newest undismissed pending request, and clear a banner whose request is no longer
    pending (decided elsewhere while we were disconnected).
    */
    const resyncPendingApprovals = () => {
      void fetchApprovals({ status: "pending", limit: 50 }, currentProjectId)
        .then((list) => {
          if (disposed) return;
          const pending = [...list.requests].sort((a, b) =>
            (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? ""),
          );
          const newest = pending.find((request) => {
            const dedupeKey = `approval:${request.id}`;
            const dismissedAt = approvalDismissalsRef.current.get(dedupeKey);
            return dismissedAt === undefined || parseDateMs(request.updatedAt ?? request.createdAt) > dismissedAt;
          });
          if (!newest) {
            // Server has nothing pending for us: any banner still on screen was decided while the
            // stream was down.
            setCandidate((current) => (current === null ? current : null));
            return;
          }
          const dedupeKey = `approval:${newest.id}`;
          seenApprovalKeysRef.current.add(dedupeKey);
          triggerApprovalBanner({
            dedupeKey,
            updatedAtMs: parseDateMs(newest.updatedAt ?? newest.createdAt),
          });
        })
        .catch(() => {
          // A failed resync must not clear a banner we already have; the next reopen retries.
        });
    };

    const unsubscribe = subscribeSse(`/api/events${query}`, {
      onReconnect: resyncPendingApprovals,
      events: {
        "approval:requested": (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data) as {
              id?: string;
              taskId?: string;
              updatedAt?: string;
              createdAt?: string;
            };
            const dedupeKey = payload.id ? `approval:${payload.id}` : undefined;
            if (!dedupeKey || seenApprovalKeysRef.current.has(dedupeKey)) {
              return;
            }
            seenApprovalKeysRef.current.add(dedupeKey);
            triggerApprovalBanner({
              dedupeKey,
              updatedAtMs: parseDateMs(payload.updatedAt ?? payload.createdAt),
            });
          } catch {
            // no-op
          }
        },
        "task:updated": (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data) as { id?: string; status?: string; updatedAt?: string };
            if (!payload?.id) {
              return;
            }
            const previousStatus = taskStatusByIdRef.current.get(payload.id);
            taskStatusByIdRef.current.set(payload.id, payload.status);
            if (!gitHubStarPromptShown && didEnterDone(payload.status, previousStatus)) {
              onStarPrompt();
            }
          } catch {
            // no-op
          }
        },
      },
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [currentProjectId, gitHubStarPromptShown, onStarPrompt]);

  const dismissApproval = useCallback((dismissed: ApprovalBannerCandidate) => {
    approvalDismissalsRef.current.set(
      dismissed.dedupeKey,
      Math.max(Date.now(), dismissed.updatedAtMs),
    );
    persistApprovalBannerDismissals(approvalDismissalsRef.current);
    setCandidate(null);
  }, []);

  return { candidate, dismissApproval };
}
