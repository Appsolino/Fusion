import { useState, useEffect, useRef } from "react";
import { fetchAgentLogsWithMeta } from "../api";
import { subscribeSse } from "../sse-bus";

// Render shows only the first 20 entries; keep a small buffer above that for
// hot-reconnect/scrollback but never let the array grow unbounded — long-lived
// active agents would otherwise leak hundreds of MB into React state.
const MAX_TRANSCRIPT_ENTRIES = 200;

/**
 * Log entry from an agent's execution stream.
 *
 * Note: SSE payloads from `/api/tasks/:id/logs/stream` contain `text` field
 * (matching `AgentLogEntry` from `@fusion/core`). This interface normalizes
 * to `text` for rendering. Legacy payloads with `content` are also supported
 * for backward compatibility.
 */
export interface TranscriptEntry {
  type: string;
  /** Canonical text content — matches `AgentLogEntry.text` */
  text: string;
  timestamp?: string;
  /** Legacy field — normalized to `text` if present */
  content?: string;
}

/**
 * Hook that manages live transcript streaming for a task.
 *
 * Features project-context isolation to prevent cross-project transcript bleed:
 * - Tracks project context version to detect stale events after project switches
 * - Resets entries and connection state immediately on context change
 * - Rejects stale SSE events from previous EventSource instances
 *
 * When `taskId` changes, a new SSE connection is opened for the new task.
 * When `projectId` changes, all state is reset and a new connection is opened.
 */
export function useLiveTranscript(taskId: string | undefined, projectId?: string) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // Refs for state that needs to survive re-renders
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Track the project context version to detect stale events after project switches.
  // Incremented whenever projectId changes, invalidating any in-flight SSE handlers.
  const projectContextVersionRef = useRef(0);

  // Track previous values to detect context changes
  const previousTaskIdRef = useRef<string | undefined>(taskId);
  const previousProjectIdRef = useRef<string | undefined>(projectId);

  // Detect context changes and reset state immediately
  const contextChanged =
    previousTaskIdRef.current !== taskId ||
    previousProjectIdRef.current !== projectId;

  if (contextChanged) {
    previousTaskIdRef.current = taskId;
    previousProjectIdRef.current = projectId;
    projectContextVersionRef.current++;

    // Drop existing subscription
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    // Reset state immediately to prevent stale data visibility
    setEntries([]);
    setIsConnected(false);
  }

  useEffect(() => {
    if (!taskId) {
      setEntries([]);
      setIsConnected(false);
      return;
    }

    // Capture context version at effect start - stale events will be rejected
    const contextVersionAtStart = projectContextVersionRef.current;

    // Build stream URL with optional projectId for multi-project support
    let url = `/api/tasks/${encodeURIComponent(taskId)}/logs/stream`;
    if (projectId) {
      url += `?projectId=${encodeURIComponent(projectId)}`;
    }

    /*
    FNXC:TaskTranscript 2026-07-26-14:50:
    Missed-event recovery. `/api/tasks/:id/logs/stream` replays nothing on connect — it only forwards
    entries emitted while the socket is live — so every SSE gap (error reconnect, or the mobile
    hidden-tab suspend) punched a permanent hole in the transcript, silently mixing entries from
    before and after the gap with no marker. On reopen, replace the buffer with the persisted tail
    from GET /tasks/:id/logs, which is the same data the stream would have delivered. The API returns
    oldest-first; this hook renders newest-first.
    */
    const resyncTranscript = () => {
      void fetchAgentLogsWithMeta(taskId, projectId, { limit: MAX_TRANSCRIPT_ENTRIES })
        .then((result) => {
          if (projectContextVersionRef.current !== contextVersionAtStart) return;
          const normalized: TranscriptEntry[] = result.entries.map((raw) => ({
            type: raw.type ?? "text",
            text: raw.text ?? "",
            timestamp: raw.timestamp,
          }));
          setEntries(normalized.reverse().slice(0, MAX_TRANSCRIPT_ENTRIES));
        })
        .catch(() => {
          // Keep the current buffer on failure; the next reopen retries.
        });
    };

    const unsubscribe = subscribeSse(url, {
      onReconnect: resyncTranscript,
      events: {
        "agent:log": (event) => {
          if (projectContextVersionRef.current !== contextVersionAtStart) return;
          try {
            const raw = JSON.parse(event.data) as Partial<TranscriptEntry>;
            // Normalize: canonical `text` field, with legacy `content` fallback
            const entry: TranscriptEntry = {
              type: raw.type ?? "text",
              text: raw.text ?? raw.content ?? "",
              timestamp: raw.timestamp,
              content: raw.content,
            };
            setEntries(prev => {
              const next = [entry, ...prev];
              return next.length > MAX_TRANSCRIPT_ENTRIES
                ? next.slice(0, MAX_TRANSCRIPT_ENTRIES)
                : next;
            });
          } catch { /* skip malformed events */ }
        },
      },
      onOpen: () => {
        if (projectContextVersionRef.current === contextVersionAtStart) {
          setIsConnected(true);
        }
      },
      onError: () => {
        if (projectContextVersionRef.current === contextVersionAtStart) {
          setIsConnected(false);
        }
      },
    });
    unsubscribeRef.current = unsubscribe;

    return () => {
      unsubscribe();
      unsubscribeRef.current = null;
      if (projectContextVersionRef.current === contextVersionAtStart) {
        setIsConnected(false);
      }
    };
  }, [taskId, projectId]);

  return { entries, isConnected };
}
