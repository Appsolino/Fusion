/**
 * Lightweight stale-while-revalidate cache helpers for dashboard reload hydration.
 *
 * Board task hydration uses a dedicated bound (`SWR_TASKS_MAX_AGE_MS`) sized to outlive a mobile tab discard; see the TTL block below.
 * Chat messages and chat agents maps reuse that bound for thread state, while models and discovered skills use the shared default window for effectively session-static hydration.
 * Room message/member hydration uses `SWR_CHAT_ROOM_MAX_AGE_MS` for warm-first room opens while keeping background revalidation mandatory.
 * Failed task revalidation clears the per-project tasks envelope to avoid re-hydrating stale data on the next reload.
 *
 * Invalidation contract:
 * - Per-project task entries use `SWR_CACHE_KEYS.TASKS_PREFIX + projectId`.
 * - Version updates clear TASKS_PREFIX plus PROJECTS and CURRENT_PROJECT_ID.
 */
export const SWR_CACHE_KEYS = {
  PROJECTS: "kb-dashboard-projects-cache",
  CURRENT_PROJECT_ID: "kb-dashboard-current-project-cache",
  TASKS_PREFIX: "kb-dashboard-tasks-cache:",
  AGENTS: "kb-dashboard-agents-cache",
  AGENT_STATS: "kb-dashboard-agent-stats-cache",
  DOCUMENTS_PREFIX: "kb-dashboard-documents-cache:",
  ARTIFACTS_PREFIX: "kb-dashboard-artifacts-cache:",
  TODO_LISTS_PREFIX: "kb-dashboard-todo-lists-cache:",
  CHAT_ROOMS: "kb-dashboard-chat-rooms-cache",
  CHAT_SESSIONS_PREFIX: "kb-dashboard-chat-sessions-cache:",
  CHAT_MESSAGES_PREFIX: "kb-dashboard-chat-messages-cache:",
  // FNXC:ChatRooms 2026-07-16-00:00: FN-8062 changes room message snapshots from server-descending to display-ascending; namespace the cache so an old 60-second snapshot never flashes out of order after deploy.
  CHAT_ROOM_MESSAGES_PREFIX: "kb-dashboard-chat-room-messages-cache:v2:",
  CHAT_ROOM_MEMBERS_PREFIX: "kb-dashboard-chat-room-members-cache:",
  CHAT_AGENTS_MAP_PREFIX: "kb-dashboard-chat-agents-map-cache:",
  MODELS: "kb-dashboard-models-cache",
  DISCOVERED_SKILLS_PREFIX: "kb-dashboard-discovered-skills-cache:",
  ACTIVE_CHAT_ROOM_ID: "kb-dashboard-active-chat-room-cache",
  INSIGHTS_PREFIX: "kb-dashboard-insights-cache:",
  INSIGHT_LATEST_RUN_PREFIX: "kb-dashboard-insight-latest-run-cache:",
  RESEARCH_RUNS_PREFIX: "kb-dashboard-research-runs-cache:",
  RESEARCH_SELECTED_ID_PREFIX: "kb-dashboard-research-selected-cache:",
  EVALS_RUNS_PREFIX: "kb-dashboard-evals-runs-cache:",
  EVALS_RESULTS_PREFIX: "kb-dashboard-evals-results-cache:",
  MISSIONS_PREFIX: "kb-dashboard-missions-cache:",
  MAILBOX_INBOX_PREFIX: "kb-dashboard-mailbox-inbox-cache:",
  MAILBOX_OUTBOX_PREFIX: "kb-dashboard-mailbox-outbox-cache:",
  MAILBOX_UNREAD_COUNT_PREFIX: "kb-dashboard-mailbox-unread-cache:",
} as const;

const DEFAULT_MAX_BYTES = 500_000;

interface CacheEnvelope<T> {
  savedAt: number;
  data: T;
}


/*
FNXC:MobileTabDiscard 2026-07-26-10:20:
These hydration TTLs exist to survive an OS/browser TAB DISCARD, not to bound data freshness.
On iOS Safari, iOS PWAs, and Chrome Android the dashboard tab is evicted after a few minutes in the
background; returning to it re-executes the bundle from scratch. The previous 60s task/room bounds
guaranteed the snapshot was ALWAYS expired on that return (the user was away "a few minutes"), so the
board painted empty and re-fetched from [] — the reported white-then-empty restore.

Correctness comes from the revalidation that every consumer issues immediately after hydrating, plus
the failure path that CLEARS the entry when that revalidation fails; it does NOT come from a short TTL.
A stale-for-one-frame board behind a visible revalidation indicator is strictly better than an empty one.

All values stay strictly below SWR_LONG_MAX_AGE_MS (24h), which is the boot-time
`pruneStaleCacheEntries()` window — a TTL at or above that window would be unreachable in practice
because the prune deletes the entry before any hydration hook reads it.
*/
// Shared default for non-live dashboard hydration paths (projects, agents, documents, todos, models,
// insights, evals, artifacts, room members). All of these revalidate on mount.
export const SWR_DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// Board hydration bound: paint the last known board instantly on restore, then revalidate.
export const SWR_TASKS_MAX_AGE_MS = 12 * 60 * 60 * 1000;
// Room message hydration bound; `loadRoomData` always refetches members+messages after hydrating.
export const SWR_CHAT_ROOM_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const SWR_LONG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function getLocalStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  return null;
}

/**
 * FNXC:MobileTabDiscard 2026-07-26-14:05:
 * Envelope-aware read. `readCache` deliberately discards `savedAt`, which was fine while every
 * hydration TTL was ~60s (any hydrated snapshot was younger than every downstream freshness
 * threshold, so "as of now" was a harmless approximation). Raising `SWR_TASKS_MAX_AGE_MS` to hours
 * for the mobile tab-discard restore broke that assumption: a consumer that hydrates an hours-old
 * board and then reasons about elapsed time against `Date.now()` reports every in-progress card as
 * stuck. Consumers deriving time-sensitive state from a hydrated snapshot MUST read through this
 * function and carry `savedAt` as their "data as of" clock.
 *
 * Returns `null` for exactly the cases `readCache` treats as a miss (absent, malformed, expired);
 * `readCache` is a thin wrapper so existing call sites are unchanged.
 */
export function readCacheEntry<T>(key: string, options?: { maxAgeMs?: number }): CacheReadResult<T> | null {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(key);
    if (raw === null) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { data: parsed as T, savedAt: undefined };
    }

    const hasEnvelopeMarkers = "savedAt" in parsed || "data" in parsed;
    if (!hasEnvelopeMarkers) {
      return { data: parsed as T, savedAt: undefined };
    }

    const envelope = parsed as Partial<CacheEnvelope<T>>;
    if (typeof envelope.savedAt !== "number" || Number.isNaN(envelope.savedAt)) {
      return { data: (envelope.data ?? null) as T, savedAt: undefined };
    }

    const maxAgeMs = options?.maxAgeMs;
    if (typeof maxAgeMs === "number") {
      const ageMs = Date.now() - envelope.savedAt;
      if (ageMs > maxAgeMs) {
        /*
        FNXC:SwrCache 2026-07-02-00:00:
        Lazy GC: drop the stale entry so it stops consuming localStorage quota. A stale
        entry is already treated as a miss by every reader (they re-fetch and overwrite),
        so deleting it on read is behavior-preserving. This prevents per-session and
        per-room message caches from accumulating when a reader revisits a stale key.
        */
        try {
          storage.removeItem(key);
        } catch {
          // Ignore storage errors — the stale read still returns null.
        }
        return null;
      }
    }

    return { data: (envelope.data ?? null) as T, savedAt: envelope.savedAt };
  } catch {
    return null;
  }
}

export function readCache<T>(key: string, options?: { maxAgeMs?: number }): T | null {
  const entry = readCacheEntry<T>(key, options);
  return entry === null ? null : entry.data;
}

/**
 * FNXC:MobileTabDiscard 2026-07-26-10:26:
 * Returns whether the snapshot was actually persisted. An over-budget payload is still dropped
 * silently (that bound protects the localStorage quota), but the drop can no longer be INVISIBLE to
 * the caller: a large board used to exceed `maxBytes`, write nothing, and therefore have no snapshot
 * at all to hydrate from after a mobile tab discard — the exact restore this cache exists to fix.
 * Callers that can shrink their payload (see `writeTaskCacheSnapshot` in useTasks) retry on `false`.
 * The return value is additive; existing callers ignore it.
 */
export function writeCache<T>(key: string, value: T, options?: { maxBytes?: number }): boolean {
  const storage = getLocalStorage();
  if (!storage) {
    return false;
  }

  try {
    const serialized = JSON.stringify({
      savedAt: Date.now(),
      data: value,
    } satisfies CacheEnvelope<T>);
    const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    if (new TextEncoder().encode(serialized).length > maxBytes) {
      return false;
    }

    storage.setItem(key, serialized);
    return true;
  } catch {
    // Ignore quota and storage errors.
    return false;
  }
}

export function clearCache(prefix: string): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    const keys = new Set<string>();

    for (const key in storage) {
      if (Object.prototype.hasOwnProperty.call(storage, key) && key.startsWith(prefix)) {
        keys.add(key);
      }
    }

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(prefix)) {
        keys.add(key);
      }
    }

    for (const key of keys) {
      storage.removeItem(key);
    }
  } catch {
    // Ignore storage errors.
  }
}

/**
 * FNXC:SwrCache 2026-07-02-00:00:
 * Boot-time sweep that removes every SWR hydration entry older than SWR_LONG_MAX_AGE_MS (24h).
 * Since 24h is the longest TTL any consumer passes to readCache, a pruned entry was already
 * treated as a miss by every reader — this frees quota without changing hydration behavior.
 * The main target is per-session / per-room message caches from abandoned conversations that
 * are never read again (and therefore never hit readCache's lazy GC). Called once from the
 * DashboardLoader mount so it runs before hydration hooks read their caches.
 *
 * Returns the number of entries removed for diagnostics.
 */
export function pruneStaleCacheEntries(): number {
  const storage = getLocalStorage();
  if (!storage) {
    return 0;
  }

  let removed = 0;
  try {
    const staleKeys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key !== "string" || !key.startsWith("kb-dashboard-")) {
        continue;
      }
      const raw = storage.getItem(key);
      if (raw === null) {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || !("savedAt" in parsed)) {
          continue;
        }
        const savedAt = parsed.savedAt;
        if (typeof savedAt !== "number" || Number.isNaN(savedAt)) {
          continue;
        }
        if (Date.now() - savedAt > SWR_LONG_MAX_AGE_MS) {
          staleKeys.push(key);
        }
      } catch {
        // Malformed JSON — leave it; readCache/clearCache handle their own parsing.
      }
    }

    for (const key of staleKeys) {
      storage.removeItem(key);
      removed += 1;
    }
  } catch {
    // Ignore storage errors.
  }

  return removed;
}

/**
 * FNXC:SwrCache 2026-07-02-00:00:
 * User-facing "Clear local data" helper: removes all Fusion-owned browser data — SWR
 * hydration caches plus per-project scoped preferences and global UI preferences — while
 * preserving the dashboard auth token so a reload keeps the session usable. Wired to
 * Settings → General "Clear local data" as the escape hatch for quota exhaustion. Callers
 * should reload the page after this so React state re-hydrates from a clean slate.
 *
 * Returns the number of keys removed for diagnostics.
 */
export const LOCAL_CACHE_PRESERVE_KEYS: Readonly<Record<string, true>> = { "fn.authToken": true };

function isFusionOwnedKey(key: string): boolean {
  return (
    key.startsWith("kb-") ||
    key.startsWith("kb:") ||
    key.startsWith("fn-agent-log-") ||
    key.startsWith("fusion")
  );
}

export function clearAllLocalCache(): number {
  const storage = getLocalStorage();
  if (!storage) {
    return 0;
  }

  let removed = 0;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string") {
        keys.push(key);
      }
    }

    for (const key of keys) {
      if (key in LOCAL_CACHE_PRESERVE_KEYS || !isFusionOwnedKey(key)) {
        continue;
      }
      storage.removeItem(key);
      removed += 1;
    }
  } catch {
    // Ignore storage errors.
  }

  return removed;
}
