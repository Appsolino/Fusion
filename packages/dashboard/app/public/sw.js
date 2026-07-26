const CACHE_NAME = "fusion-cache-v6";

/*
FNXC:PWAOffline 2026-07-26-10:12:
Mobile browsers (iOS Safari tabs, iOS installed PWAs, Chrome Android) discard backgrounded pages under memory pressure. When the user returns, the tab is re-navigated from scratch, so restore cost IS the perceived bug: a network-first bundle refetch pulls ~2.8MB raw / 750KB gzipped of entry chunk (14MB across ~130 chunks) over a just-waking radio before anything paints, producing the white splash.

Vite emits content-hashed asset filenames (`[name]-[hash].[ext]`), so a hashed URL's bytes can never change — a new build emits a NEW url. Those are therefore safe to serve cache-first: a cache hit is authoritative, and a post-deploy hash simply misses and is fetched. HASHED_ASSET_PATTERN is the conservative gate for that guarantee; anything under /assets/ that does not prove it carries a hash stays network-first.

Conservatism rules for the pattern: the trailing dash-delimited segment of the basename must be >=8 chars of Vite's base64url hash alphabet (dash permitted only as the final character, which keeps the segment genuinely trailing instead of letting the match span earlier dashes) AND must contain at least one uppercase letter or digit. Human-authored kebab-case basenames (`vendor-runtime.js`, `foo-bar-baz.css`) fail the mixed-alphabet check and stay network-first. A real hash fails the pattern only when it embeds a dash before its last character (~10% of hashes) or is all-lowercase-alpha ((28/64)^8, ~0.1%); both are harmless downgrades to the previous network-first behavior, never a stale-serve.
*/
const HASHED_ASSET_PATTERN = /-(?=[A-Za-z0-9_-]*[A-Z0-9])[A-Za-z0-9_]{7,}[A-Za-z0-9_-]?\.[A-Za-z0-9]+$/;

/**
 * FNXC:PWAOffline 2026-07-26-10:18:
 * Cache-first eligibility. Two admissible classes:
 * 1. Content-hashed build assets under /assets/ — immutable by construction (see HASHED_ASSET_PATTERN).
 * 2. Font requests (`request.destination === "font"`, e.g. the preloaded /fonts/SymbolsNerdFontMono-Regular.ttf) — not hash-named, but immutable in practice; a replaced font is picked up on the next CACHE_NAME bump. Blocking first paint on a font refetch over a waking radio is not worth that staleness window.
 *
 * Deliberately NOT admissible: the navigation shell, /api/*, and non-hashed scripts/styles.
 *
 * @param {URL} url
 * @param {Request} request
 * @returns {boolean}
 */
function isImmutableAssetRequest(url, request) {
  if (request.destination === "font") {
    return true;
  }
  return url.pathname.startsWith("/assets/") && HASHED_ASSET_PATTERN.test(url.pathname);
}

/*
FNXC:PWAOffline 2026-07-26-14:05:
Cache-first hashed assets made cache SIZE load-bearing, and nothing evicted within a generation — `activate` only drops caches whose key !== CACHE_NAME, and CACHE_NAME is a hand-bumped literal. Fusion is self-hosted and rebuilt constantly (Command Center "Rebuild + restart" reloads the page onto a new build), each build emitting ~130 fresh hashed chunks (~14MB). Every prior build's chunks stayed resident forever, so a week of daily rebuilds parks ~100MB of dead chunks on the origin. On iOS the origin quota is enforced per-origin and eviction is ALL-OR-NOTHING for the bucket: blowing it wipes localStorage too, taking out the SWR board snapshot and the `kb-dashboard-*` preferences that the rest of the restore work depends on. So the unbounded cache does not merely waste disk — it can destroy the very state that makes restore cheap.

Chosen bound: an insertion-ordered entry cap over hashed /assets/ entries only.
- Why not "keep only what the current index.html references": index.html names only the entry chunk; the other ~129 are lazy imports discovered inside JS. Reconstructing that graph in the SW means parsing bundles — fragile, and a mis-parse strands the user on a failed dynamic import.
- Why not a CACHE_NAME-per-build bump: correct in principle, but CACHE_NAME is a literal in a static, untemplated file. Doing it properly needs build-time templating of sw.js (a Vite plugin emitting the build hash) — real build wiring, not a one-line change, and out of scope here. Recorded as the eventual better answer rather than faked with a hardcoded hash.
- Why insertion order is the right recency proxy: hashed URLs are immutable, so an entry is only ever inserted once, at the moment its build first ran. Cache API `keys()` is specified to return entries in insertion order, so oldest-first == oldest-build-first. Evicting from the front removes dead builds before live ones, with no metadata bookkeeping to persist or corrupt.

Safety against evicting an asset the RUNNING build still needs: every hashed URL this service-worker session has served (hit or miss) is recorded in `sessionReferencedAssets` and is exempt from eviction while it remains in that set (itself bounded — see MAX_SESSION_REFERENCED_ASSETS). A chunk the current page has already loaded is thereby pinned. A not-yet-lazy-loaded chunk of the current build is protected by the cap being sized for multiple builds, and by the fact that it is at the END of insertion order. `versionCheck.ts`'s handleChunkLoadError/isStaleChunkError remains a backstop, deliberately not the primary design.
*/
const MAX_IMMUTABLE_CACHE_ENTRIES = 200;

/*
FNXC:PWAOffline 2026-07-26-14:05:
The eviction-exemption set must itself be bounded, or it re-opens the hole it exists to make safe: a
service worker that survives many rebuilds (they are cheap to keep alive under active use) would
accumulate every build's served chunks as permanently-exempt and the cap could never bite. Capping it
drop-oldest makes the resident set provably bounded at MAX_IMMUTABLE_CACHE_ENTRIES +
MAX_SESSION_REFERENCED_ASSETS in the worst case rather than unbounded. Dropping the oldest exemption
is safe for the same reason eviction is: a chunk evicted but still needed is re-fetched from the
network, and the only unrecoverable case (build gone from the server) is the stale-chunk case
versionCheck.ts handles and would occur with no cache at all.
*/
const MAX_SESSION_REFERENCED_ASSETS = 200;

/** @type {Set<string>} URLs of hashed assets served during this SW session; exempt from eviction. Set iteration is insertion-ordered, so the first entry is the oldest. */
const sessionReferencedAssets = new Set();

/**
 * @param {string} requestUrl
 * @returns {void}
 */
function rememberSessionReferencedAsset(requestUrl) {
  sessionReferencedAssets.delete(requestUrl);
  sessionReferencedAssets.add(requestUrl);
  while (sessionReferencedAssets.size > MAX_SESSION_REFERENCED_ASSETS) {
    const oldest = sessionReferencedAssets.values().next();
    if (oldest.done) {
      break;
    }
    sessionReferencedAssets.delete(oldest.value);
  }
}

/** Prune runs are single-flight; overlapping cold-path misses must not scan/delete concurrently. */
let immutablePruneInFlight = false;

/**
 * FNXC:PWAOffline 2026-07-26-14:05:
 * URL-only classifier for prunable entries. Deliberately does NOT reuse isImmutableAssetRequest():
 * that one consults `request.destination`, which is not guaranteed to survive a round trip through
 * the Cache API on a `keys()` result. Fonts therefore fall outside the prunable set — there are a
 * handful of them and they are not the growth term.
 *
 * @param {string} requestUrl
 * @returns {boolean}
 */
function isPrunableAssetUrl(requestUrl) {
  try {
    const pathname = new URL(requestUrl).pathname;
    return pathname.startsWith("/assets/") && HASHED_ASSET_PATTERN.test(pathname);
  } catch {
    return false;
  }
}

/**
 * FNXC:PWAOffline 2026-07-26-14:05:
 * Evict oldest-inserted hashed assets until the hashed-entry count is back under the cap, skipping
 * anything this session referenced. If every over-cap entry is session-referenced the sweep simply
 * does less work than requested — never evicting a live chunk is more important than hitting the cap
 * exactly. Fully defensive: it is invoked fire-and-forget so a throw, a rejected delete, or a slow
 * keys() scan can never delay or fail the fetch response it was triggered from.
 *
 * @param {Cache} cache
 * @returns {Promise<void>}
 */
async function pruneImmutableAssetCache(cache) {
  if (immutablePruneInFlight) {
    return;
  }
  immutablePruneInFlight = true;
  try {
    const keys = await cache.keys();
    const evictable = [];
    let hashedTotal = 0;

    for (const cachedRequest of keys) {
      if (!cachedRequest || !isPrunableAssetUrl(cachedRequest.url)) {
        continue;
      }
      hashedTotal += 1;
      if (!sessionReferencedAssets.has(cachedRequest.url)) {
        evictable.push(cachedRequest);
      }
    }

    let overflow = hashedTotal - MAX_IMMUTABLE_CACHE_ENTRIES;
    if (overflow <= 0) {
      return;
    }

    for (const cachedRequest of evictable) {
      if (overflow <= 0) {
        break;
      }
      try {
        await cache.delete(cachedRequest);
        overflow -= 1;
      } catch (deleteError) {
        console.warn("[sw] immutable asset eviction failed", deleteError);
      }
    }
  } catch (error) {
    console.warn("[sw] immutable asset prune failed", error);
  } finally {
    immutablePruneInFlight = false;
  }
}

/**
 * FNXC:PWAOffline 2026-07-26-14:05:
 * Fire-and-forget prune trigger. Runs on the cold path only (after a cache MISS populated a new
 * entry, i.e. exactly when a new build is arriving) and on activate. Not awaited: awaiting would put
 * an O(cache) keys() scan in front of each of a new build's ~130 first-load chunk responses.
 *
 * @param {Cache} cache
 * @returns {void}
 */
function scheduleImmutableAssetPrune(cache) {
  try {
    void pruneImmutableAssetCache(cache);
  } catch (error) {
    console.warn("[sw] immutable asset prune scheduling failed", error);
  }
}

const APP_SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/logo.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL_URLS);
      await self.skipWaiting();
    } catch (error) {
      console.warn("[sw] install cache warmup failed", error);
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      // FNXC:PWAOffline 2026-07-26-14:05: cross-generation eviction above only fires on a
      // CACHE_NAME bump; this bounds the CURRENT generation on every SW activation too.
      try {
        const cache = await caches.open(CACHE_NAME);
        await pruneImmutableAssetCache(cache);
      } catch (pruneError) {
        console.warn("[sw] activate prune failed", pruneError);
      }
      await self.clients.claim();
    } catch (error) {
      console.warn("[sw] activate cleanup failed", error);
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  const accept = request.headers.get("accept") ?? "";
  const isApiRequest = url.pathname.startsWith("/api/");
  const isEventStreamRequest =
    accept.includes("text/event-stream") ||
    url.pathname === "/api/events" ||
    url.pathname.startsWith("/api/events/");
  const isNavigationRequest =
    request.mode === "navigate" ||
    request.destination === "document" ||
    url.pathname === "/" ||
    url.pathname === "/index.html";
  const isBuiltAssetRequest =
    url.pathname.startsWith("/assets/") ||
    request.destination === "script" ||
    request.destination === "style";
  // NOTE: `request.destination === "font"` used to be listed here. Fonts are
  // now claimed by isImmutableAssetRequest() above, so repeating them would be
  // an unreachable branch.

  // EventSource requests stay open indefinitely. Waiting on cache.put() for an
  // infinite response body prevents the browser from ever receiving the stream
  // and leaks the underlying connection across reloads. Let SSE bypass the
  // service worker entirely so the browser talks to the network directly.
  if (isEventStreamRequest) {
    return;
  }

  /*
  FNXC:PWAOffline 2026-07-26-10:24:
  The navigation shell MUST stay network-first. index.html is the only unhashed document in the graph, so it is the single source of truth for which hashed asset URLs are current. Keeping it fresh is precisely what makes cache-first hashed assets safe: after a deploy the fresh shell names new hashes, those miss the cache, and are fetched. Serving the shell from cache would pin the tab to a previous build's hashes indefinitely. Cache remains an offline fallback only.
  */
  if (isNavigationRequest) {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request);
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, networkResponse.clone());
        } catch (cacheError) {
          console.warn("[sw] navigation cache put failed", cacheError);
        }
        return networkResponse;
      } catch (networkError) {
        const fallback = await caches.match(request);
        if (fallback) {
          return fallback;
        }
        throw networkError;
      }
    })());
    return;
  }

  if (isApiRequest) {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request);
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, networkResponse.clone());
        } catch (cacheError) {
          console.warn("[sw] api cache put failed", cacheError);
        }
        return networkResponse;
      } catch (networkError) {
        try {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
        } catch (cacheError) {
          console.warn("[sw] api cache lookup failed", cacheError);
        }
        throw networkError;
      }
    })());
    return;
  }

  /*
  FNXC:PWAOffline 2026-07-26-10:31:
  Immutable assets are served CACHE-FIRST: a hit returns without touching the network, so a discarded-and-restored mobile tab repaints from local storage instead of re-downloading the bundle over a waking radio. On a miss we fetch, populate, and return.

  This replaces the previous network-first-for-everything rule, which existed out of a stale-JS fear. That fear does not apply here: the URL is content-hashed, so its bytes are immutable and a hit can never be "stale" — a rebuild produces a different URL, which misses. The fear DOES apply to the navigation shell, which is why that branch above is left network-first.

  Only `response.ok` is cached. A hashed URL that 404s (deploy mid-flight, partially uploaded build) must never be pinned into an immutable cache entry, because nothing would ever evict it before the next CACHE_NAME bump.
  */
  if (isImmutableAssetRequest(url, request)) {
    event.respondWith((async () => {
      // FNXC:PWAOffline 2026-07-26-14:05: recorded BEFORE the hit/miss branch so an asset the
      // running build is using is eviction-exempt whether it came from cache or network.
      rememberSessionReferencedAsset(request.url);
      try {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }

        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          try {
            await cache.put(request, networkResponse.clone());
            scheduleImmutableAssetPrune(cache);
          } catch (cacheError) {
            console.warn("[sw] immutable asset cache put failed", cacheError);
          }
        }
        return networkResponse;
      } catch (error) {
        console.warn("[sw] immutable asset cache flow failed", error);
        const fallback = await caches.match(request);
        if (fallback) {
          return fallback;
        }
        return fetch(request);
      }
    })());
    return;
  }

  // Non-hashed built assets (unhashed scripts/styles, anything under /assets/
  // that cannot prove it carries a content hash) keep the network-first path:
  // their URL is not a content identity, so a cached copy can genuinely go
  // stale and blank the app after an update. Cache stays an offline fallback.
  if (isBuiltAssetRequest) {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request);
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, networkResponse.clone());
        } catch (cacheError) {
          console.warn("[sw] asset cache put failed", cacheError);
        }
        return networkResponse;
      } catch (networkError) {
        try {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
        } catch (cacheError) {
          console.warn("[sw] asset cache lookup failed", cacheError);
        }
        throw networkError;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }

      const networkResponse = await fetch(request);
      await cache.put(request, networkResponse.clone());
      return networkResponse;
    } catch (error) {
      console.warn("[sw] static cache flow failed", error);
      return fetch(request);
    }
  })());
});
