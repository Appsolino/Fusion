import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { loadAllAppCss } from "../test/cssFixture";

/*
FNXC:PWAOffline 2026-07-26-10:44:
Restore latency after a mobile discard is a behavior, not a source-string shape, so it needs an executable seam. Evaluating sw.js in a fresh vm context with fake `caches`/`fetch` exercises the real fetch handler without a browser, a build step, or any timers — the cheapest harness that can prove "cache hit means zero network calls".
*/
type FakeResponse = { ok: boolean; body: string; clone: () => FakeResponse };

function makeResponse(body: string, ok = true): FakeResponse {
  const response: FakeResponse = { ok, body, clone: () => response };
  return response;
}

type FakeRequest = {
  url: string;
  method: string;
  mode?: string;
  destination?: string;
  headers: { get: (name: string) => string | null };
};

function makeRequest(url: string, init: { mode?: string; destination?: string } = {}): FakeRequest {
  return {
    url,
    method: "GET",
    mode: init.mode ?? "no-cors",
    destination: init.destination ?? "",
    headers: { get: () => null },
  };
}

/*
FNXC:PWAOffline 2026-07-26-14:05:
`store` is a Map, whose iteration order is insertion order — the same ordering guarantee the Cache API
gives `cache.keys()` and which the SW's eviction relies on. Passing an existing store into a second
loadServiceWorker() call models a service worker that was terminated and restarted between builds,
which is the realistic shape of "successive rebuilds against one persistent origin cache".
*/
function loadServiceWorker(existingStore?: Map<string, FakeResponse>) {
  const source = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");
  const store = existingStore ?? new Map<string, FakeResponse>();
  const fetchMock = vi.fn(async (request: FakeRequest) => makeResponse(`network:${request.url}`));

  const cache = {
    match: async (request: FakeRequest) => store.get(request.url),
    put: async (request: FakeRequest, response: FakeResponse) => {
      store.set(request.url, response);
    },
    addAll: async () => undefined,
    keys: async () => [...store.keys()].map((url) => ({ url })),
    delete: async (request: { url: string }) => store.delete(request.url),
  };
  const caches = {
    open: async () => cache,
    match: async (request: FakeRequest) => store.get(request.url),
    keys: async () => [],
    delete: async () => true,
  };

  const listeners = new Map<string, (event: unknown) => void>();
  const sandbox = {
    self: {
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        listeners.set(type, handler);
      },
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined },
    },
    caches,
    fetch: fetchMock,
    console,
    URL,
  };

  runInNewContext(source, sandbox);

  async function handleFetch(request: FakeRequest): Promise<FakeResponse | undefined> {
    const fetchListener = listeners.get("fetch");
    expect(fetchListener).toBeTypeOf("function");

    let responded: Promise<FakeResponse> | undefined;
    fetchListener!({
      request,
      respondWith: (value: Promise<FakeResponse>) => {
        responded = value;
      },
      waitUntil: () => undefined,
    });

    return responded ? await responded : undefined;
  }

  async function runActivate(): Promise<void> {
    const activateListener = listeners.get("activate");
    expect(activateListener).toBeTypeOf("function");

    let pending: Promise<unknown> | undefined;
    activateListener!({
      waitUntil: (value: Promise<unknown>) => {
        pending = value;
      },
    });

    if (pending) await pending;
  }

  return { handleFetch, runActivate, fetchMock, store, cache };
}

/*
FNXC:PWAOffline 2026-07-26-14:05:
The SW schedules cache pruning fire-and-forget so it can never delay a fetch response. The prune chain
contains only already-resolved promises against the fake cache, so a single macrotask turn drains it —
no fake timers, no polling, no arbitrary sleep.
*/
async function flushPendingPrune(): Promise<void> {
  await new Promise((done) => setTimeout(done, 0));
}

function buildAssetUrl(build: number, index: number): string {
  // Mimics Vite's `[name]-[hash].js`; the hash segment must satisfy HASHED_ASSET_PATTERN.
  return `https://fusion.test/assets/chunk-B${String(build).padStart(3, "0")}Z${String(index).padStart(4, "0")}.js`;
}

function countCachedAssets(store: Map<string, FakeResponse>): number {
  return [...store.keys()].filter((url) => url.includes("/assets/")).length;
}

const HASHED_ASSET_URL = "https://fusion.test/assets/index-CydU98D-.js";

type DecodedPng = {
  width: number;
  height: number;
  colorType: number;
  pixels: Buffer;
};

function getStandaloneDisplayModeBlock(css: string): string {
  const match = /@media\s*\(\s*display-mode:\s*standalone\s*\)\s*\{/.exec(css);
  expect(match).toBeTruthy();

  const start = match!.index;
  const open = css.indexOf("{", start);
  let depth = 1;
  let i = open + 1;

  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }

  return css.slice(start, i);
}

function decodeRgbaPng(filePath: string): DecodedPng {
  const buffer = readFileSync(filePath);
  const signature = buffer.subarray(0, 8).toString("hex");
  expect(signature).toBe("89504e470d0a1a0a");

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  expect(bitDepth).toBe(8);
  expect(colorType).toBe(6);

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  let inputOffset = 0;
  let outputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;

    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[inputOffset + x];
      const left = x >= bytesPerPixel ? pixels[outputOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[outputOffset + x - stride] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[outputOffset + x - stride - bytesPerPixel] : 0;
      let value: number;

      if (filter === 0) {
        value = raw;
      } else if (filter === 1) {
        value = raw + left;
      } else if (filter === 2) {
        value = raw + up;
      } else if (filter === 3) {
        value = raw + Math.floor((left + up) / 2);
      } else if (filter === 4) {
        const predictor = left + up - upLeft;
        const pa = Math.abs(predictor - left);
        const pb = Math.abs(predictor - up);
        const pc = Math.abs(predictor - upLeft);
        const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        value = raw + paeth;
      } else {
        throw new Error(`Unsupported PNG filter ${filter} in ${filePath}`);
      }

      pixels[outputOffset + x] = value & 0xff;
    }

    inputOffset += stride;
    outputOffset += stride;
  }

  return { width, height, colorType, pixels };
}

describe("PWA configuration", () => {
  it("manifest defines required PWA fields and icon sizes", () => {
    const manifestPath = resolve(__dirname, "../public/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      display?: string;
      icons?: Array<{ src?: string; sizes?: string; type?: string; purpose?: string }>;
    };

    expect(manifest.name).toBe("Fusion");
    expect(manifest.short_name).toBe("Fusion");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons).toContainEqual({
      src: "/icons/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    });
    expect(manifest.icons).toContainEqual({
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    });
  });

  it("index.html includes required PWA meta tags", () => {
    const indexHtml = readFileSync(resolve(__dirname, "../index.html"), "utf8");

    expect(indexHtml).toContain('<link rel="manifest"');
    expect(indexHtml).toContain("apple-mobile-web-app-capable");
  });

  it("viewport meta includes viewport-fit=cover for safe-area support", () => {
    const indexHtml = readFileSync(resolve(__dirname, "../index.html"), "utf8");

    expect(indexHtml).toMatch(/<meta\s+name="viewport"[^>]*content="[^"]*viewport-fit=cover[^"]*"/i);
  });

  it("viewport meta keeps mobile baseline + safe-area support", () => {
    const indexHtml = readFileSync(resolve(__dirname, "../index.html"), "utf8");

    expect(indexHtml).toMatch(/<meta\s+name="viewport"[^>]*content="[^"]*width=device-width[^"]*"/i);
    expect(indexHtml).toMatch(/<meta\s+name="viewport"[^>]*content="[^"]*initial-scale=1\.0[^"]*"/i);
    expect(indexHtml).toMatch(/<meta\s+name="viewport"[^>]*content="[^"]*viewport-fit=cover[^"]*"/i);
  });

  it("CSS includes display-mode: standalone rule with a :root token override only", () => {
    const cssContent = loadAllAppCss();
    const standaloneBlock = getStandaloneDisplayModeBlock(cssContent);

    expect(standaloneBlock).toContain("@media (display-mode: standalone)");
    expect(standaloneBlock).toMatch(/:root\s*\{[\s\S]*?--standalone-bottom-gap:\s*var\(--space-sm\)/);
    expect(standaloneBlock).not.toContain("#root {");
  });

  it("CSS defines --standalone-bottom-gap token in :root", () => {
    const cssContent = loadAllAppCss();

    // Base token defaults to 0px and standalone mode overrides it via :root inside display-mode media query.
    expect(cssContent).toContain("--standalone-bottom-gap: 0px");
    expect(cssContent).toContain("--standalone-bottom-gap: var(--space-sm)");
  });

  it("CSS applies standalone bottom gap via scoped mobile layout rules, not global #root padding", () => {
    const cssContent = loadAllAppCss();

    expect(cssContent).toMatch(/\.project-content--with-mobile-nav\s*\{[^}]*var\(--standalone-bottom-gap\)/);
    expect(cssContent).toMatch(/\.executor-status-bar\s*\{[^}]*var\(--standalone-bottom-gap\)/);
    expect(cssContent).not.toMatch(/#root\s*\{[^}]*var\(--standalone-bottom-gap\)/);
  });

  it("service worker contains lifecycle handlers and versioned cache name", () => {
    const swSource = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");

    expect(swSource).toContain('addEventListener("install"');
    expect(swSource).toContain('addEventListener("fetch"');
    expect(swSource).toContain('addEventListener("activate"');
    expect(swSource).toContain('const CACHE_NAME = "fusion-cache-v6";');
  });

  it("service worker bypasses SSE requests instead of trying to cache them", () => {
    const swSource = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");

    expect(swSource).toContain('text/event-stream');
    expect(swSource).toContain('url.pathname === "/api/events"');
    expect(swSource).toContain('url.pathname.startsWith("/api/events/")');
    expect(swSource).toContain("if (isEventStreamRequest) {");
    expect(swSource).toContain("return;");
  });

  it("service worker revalidates navigation requests so index.html cannot stay stale", () => {
    const swSource = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");

    expect(swSource).toContain('request.mode === "navigate"');
    expect(swSource).toContain('request.destination === "document"');
    expect(swSource).toContain('url.pathname === "/index.html"');
    expect(swSource).toContain('[sw] navigation cache put failed');
  });

  it("service worker revalidates built assets so stale bundles cannot blank the app", () => {
    const swSource = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");

    expect(swSource).toContain('url.pathname.startsWith("/assets/")');
    expect(swSource).toContain('request.destination === "script"');
    expect(swSource).toContain('request.destination === "style"');
    expect(swSource).toContain('if (isBuiltAssetRequest) {');
    expect(swSource).toContain('[sw] asset cache put failed');
    expect(swSource).toContain('[sw] asset cache lookup failed');
  });

  it("service worker activates updated code immediately", () => {
    const swSource = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");

    expect(swSource).toContain("await self.skipWaiting()");
    expect(swSource).toContain("await self.clients.claim()");
  });

  describe("service worker restore strategy", () => {
    it("serves a cached content-hashed asset without any network call", async () => {
      const { handleFetch, fetchMock, store } = loadServiceWorker();
      store.set(HASHED_ASSET_URL, makeResponse("cached-entry-chunk"));

      const response = await handleFetch(makeRequest(HASHED_ASSET_URL, { destination: "script" }));

      expect(response?.body).toBe("cached-entry-chunk");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("falls through to the network for a hashed asset that is not cached, and populates the cache", async () => {
      const { handleFetch, fetchMock, store } = loadServiceWorker();

      const first = await handleFetch(makeRequest(HASHED_ASSET_URL, { destination: "script" }));
      expect(first?.body).toBe(`network:${HASHED_ASSET_URL}`);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(store.get(HASHED_ASSET_URL)).toBeDefined();

      const second = await handleFetch(makeRequest(HASHED_ASSET_URL, { destination: "script" }));
      expect(second?.body).toBe(`network:${HASHED_ASSET_URL}`);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("never pins a failed hashed-asset response into the immutable cache", async () => {
      const { handleFetch, fetchMock, store } = loadServiceWorker();
      fetchMock.mockImplementationOnce(async () => makeResponse("not-found", false));

      await handleFetch(makeRequest(HASHED_ASSET_URL, { destination: "script" }));

      expect(store.has(HASHED_ASSET_URL)).toBe(false);
    });

    it("keeps navigation network-first even when a cached shell exists", async () => {
      const { handleFetch, fetchMock, store } = loadServiceWorker();
      const shellUrl = "https://fusion.test/";
      store.set(shellUrl, makeResponse("cached-shell"));

      const response = await handleFetch(
        makeRequest(shellUrl, { mode: "navigate", destination: "document" }),
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(response?.body).toBe(`network:${shellUrl}`);
    });

    it("keeps a non-hashed /assets/ URL on the network-first path", async () => {
      const { handleFetch, fetchMock, store } = loadServiceWorker();
      const unhashedUrl = "https://fusion.test/assets/vendor-runtime.js";
      store.set(unhashedUrl, makeResponse("cached-unhashed"));

      const response = await handleFetch(makeRequest(unhashedUrl, { destination: "script" }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(response?.body).toBe(`network:${unhashedUrl}`);
    });

    it("serves preloaded fonts cache-first regardless of hashing", async () => {
      const { handleFetch, fetchMock, store } = loadServiceWorker();
      const fontUrl = "https://fusion.test/fonts/SymbolsNerdFontMono-Regular.ttf";
      store.set(fontUrl, makeResponse("cached-font"));

      const response = await handleFetch(makeRequest(fontUrl, { destination: "font" }));

      expect(response?.body).toBe("cached-font");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    /*
    FNXC:PWAOffline 2026-07-26-14:05:
    Cache-first hashed assets made cache size load-bearing while nothing evicted within a generation,
    so a self-hosted Fusion rebuilt daily accumulated every dead build's ~130 chunks forever. On iOS
    that risks the all-or-nothing per-origin quota eviction, which would take localStorage (SWR board
    snapshot, kb-dashboard-* prefs) with it. These tests pin the two halves of the bound: the cache
    stays capped across successive builds, and assets the running shell uses are never the ones evicted.
    */
    it("bounds the asset cache across successive rebuilds instead of growing forever", async () => {
      const buildSize = 130;
      const sharedStore = new Map<string, FakeResponse>();
      sharedStore.set("https://fusion.test/", makeResponse("cached-shell"));
      sharedStore.set("https://fusion.test/api/tasks", makeResponse("cached-tasks"));

      const counts: number[] = [];

      // Each build gets a fresh SW instance against the same persistent cache: a service worker is
      // terminated when idle, so successive rebuilds do not share one session's exemption set.
      for (let build = 1; build <= 3; build += 1) {
        const { handleFetch } = loadServiceWorker(sharedStore);
        for (let index = 0; index < buildSize; index += 1) {
          await handleFetch(makeRequest(buildAssetUrl(build, index), { destination: "script" }));
        }
        await flushPendingPrune();
        counts.push(countCachedAssets(sharedStore));
      }

      // Unbounded growth would be 130 / 260 / 390.
      expect(counts[0]).toBe(buildSize);
      expect(counts[1]).toBeLessThanOrEqual(200);
      expect(counts[2]).toBeLessThanOrEqual(200);

      // The newest build must be fully resident — eviction removes dead builds, not the live one.
      for (let index = 0; index < buildSize; index += 1) {
        expect(sharedStore.has(buildAssetUrl(3, index))).toBe(true);
      }

      // The oldest build is what got reclaimed.
      const survivingBuildOne = Array.from({ length: buildSize }, (_, index) =>
        sharedStore.has(buildAssetUrl(1, index)),
      ).filter(Boolean).length;
      expect(survivingBuildOne).toBeLessThan(buildSize);

      // Eviction is scoped to hashed /assets/ entries; the shell and API fallbacks are untouched.
      expect(sharedStore.has("https://fusion.test/")).toBe(true);
      expect(sharedStore.has("https://fusion.test/api/tasks")).toBe(true);
    });

    it("never evicts assets the current shell is using, even when they are the oldest entries", async () => {
      const { handleFetch, store } = loadServiceWorker();
      const shellAssets = Array.from({ length: 40 }, (_, index) => buildAssetUrl(9, index));

      // The running build's chunks are cached FIRST, so plain insertion-order eviction would take
      // them before anything else. The session-referenced exemption must override that ordering.
      for (const assetUrl of shellAssets) {
        await handleFetch(makeRequest(assetUrl, { destination: "script" }));
      }
      await flushPendingPrune();

      // A previous build's leftovers land in the cache *after* them (newer by insertion order).
      for (let index = 0; index < 200; index += 1) {
        store.set(buildAssetUrl(8, index), makeResponse("dead-build-chunk"));
      }

      // One more live request drives the cache over the cap and triggers a prune.
      await handleFetch(makeRequest(buildAssetUrl(9, 40), { destination: "script" }));
      await flushPendingPrune();

      for (const assetUrl of shellAssets) {
        expect(store.has(assetUrl)).toBe(true);
      }
      expect(store.has(buildAssetUrl(9, 40))).toBe(true);
      expect(countCachedAssets(store)).toBeLessThanOrEqual(200);
    });

    it("prunes an over-cap cache on activate, not only on the fetch cold path", async () => {
      const { runActivate, store } = loadServiceWorker();
      for (let index = 0; index < 250; index += 1) {
        store.set(buildAssetUrl(7, index), makeResponse("dead-build-chunk"));
      }

      await runActivate();

      expect(countCachedAssets(store)).toBe(200);
    });

    it("keeps serving assets when cache pruning throws", async () => {
      const { handleFetch, store, cache, fetchMock } = loadServiceWorker();
      cache.keys = async () => {
        throw new Error("quota inspection failed");
      };

      const response = await handleFetch(makeRequest(HASHED_ASSET_URL, { destination: "script" }));
      await flushPendingPrune();

      expect(response?.body).toBe(`network:${HASHED_ASSET_URL}`);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(store.has(HASHED_ASSET_URL)).toBe(true);
    });

    it("keeps /api/ responses network-first so cached data cannot go stale", async () => {
      const { handleFetch, fetchMock, store } = loadServiceWorker();
      const apiUrl = "https://fusion.test/api/tasks";
      store.set(apiUrl, makeResponse("cached-tasks"));

      const response = await handleFetch(makeRequest(apiUrl));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(response?.body).toBe(`network:${apiUrl}`);
    });
  });

  describe("logo assets", () => {
    it("logo.svg uses ring + swoosh geometry matching Header.tsx brand mark", () => {
      const logoSvg = readFileSync(resolve(__dirname, "../public/logo.svg"), "utf8");

      // Must contain the outer ring (circle with r=52, matching Header.tsx header-logo)
      expect(logoSvg).toContain('cx="64"');
      expect(logoSvg).toContain('cy="64"');
      expect(logoSvg).toContain('r="52"');
      expect(logoSvg).toContain('stroke-width="8"');

      // Must contain the swoosh/comet path shape (d attribute from Header.tsx)
      // The path starts with M26 101C... and creates the comet-like swoosh
      expect(logoSvg).toContain('d="M26 101');
      expect(logoSvg).toContain("fill=\"currentColor\"");

      // Must use SVG namespace
      expect(logoSvg).toContain("xmlns=");
    });

    it("logo.svg does not contain retired 4-circle glyph pattern", () => {
      const logoSvg = readFileSync(resolve(__dirname, "../public/logo.svg"), "utf8");

      // The old 4-circle glyph used circles at (44,44), (84,44), (44,84), (84,84) with r=20
      // Verify these specific circle positions are NOT present
      expect(logoSvg).not.toContain("cx=\"44\"");
      expect(logoSvg).not.toContain("cy=\"44\"");
      expect(logoSvg).not.toContain("r=\"20\"");
    });

    it("PWA icon files exist, decode to expected sizes, and are opaque non-blank PNGs", () => {
      const icons = [
        { path: resolve(__dirname, "../public/icons/icon-192.png"), size: 192 },
        { path: resolve(__dirname, "../public/icons/icon-512.png"), size: 512 },
      ];

      for (const icon of icons) {
        expect(existsSync(icon.path)).toBe(true);
        expect(statSync(icon.path).size).toBeGreaterThan(icon.size * 12);

        const png = decodeRgbaPng(icon.path);
        expect(png.width).toBe(icon.size);
        expect(png.height).toBe(icon.size);
        expect(png.colorType).toBe(6);

        let opaquePixels = 0;
        let transparentPixels = 0;
        let brandMarkPixels = 0;
        const brandBackground = [0x1a, 0x1a, 0x2e];

        for (let index = 0; index < png.pixels.length; index += 4) {
          const alpha = png.pixels[index + 3];
          if (alpha === 255) opaquePixels += 1;
          else transparentPixels += 1;

          const colorDistance =
            Math.abs(png.pixels[index] - brandBackground[0]) +
            Math.abs(png.pixels[index + 1] - brandBackground[1]) +
            Math.abs(png.pixels[index + 2] - brandBackground[2]);
          if (colorDistance > 8) brandMarkPixels += 1;
        }

        expect(transparentPixels).toBe(0);
        expect(opaquePixels).toBe(icon.size * icon.size);
        expect(brandMarkPixels).toBeGreaterThan(icon.size * icon.size * 0.1);
      }
    });

    it("wires the same PWA icons through manifest, apple touch, and service-worker precache", () => {
      const manifest = JSON.parse(readFileSync(resolve(__dirname, "../public/manifest.json"), "utf8")) as {
        icons?: Array<{ src?: string; sizes?: string; purpose?: string }>;
      };
      const indexHtml = readFileSync(resolve(__dirname, "../index.html"), "utf8");
      const swSource = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8");
      const iconSources = ["/icons/icon-192.png", "/icons/icon-512.png"];

      for (const iconSource of iconSources) {
        expect(manifest.icons?.some((icon) => icon.src === iconSource && icon.purpose === "any")).toBe(true);
        expect(swSource).toContain(`"${iconSource}"`);
      }

      expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/logo.svg" />');
      expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/icons/icon-192.png" />');
      expect(swSource).toContain('const CACHE_NAME = "fusion-cache-v6";');
    });
  });
});
