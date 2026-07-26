import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const requireFromEngine = createRequire(new URL("../../../engine/package.json", import.meta.url));
const { chromium } = requireFromEngine("playwright-core") as { chromium: { launch(options: { executablePath: string; headless: boolean; args?: string[] }): Promise<Browser> } };
type Browser = { newPage(options: { viewport: { width: number; height: number } }): Promise<Page>; close(): Promise<void> };
type Page = { goto(url: string): Promise<unknown>; evaluate<T, Arg = undefined>(fn: (arg: Arg) => T, arg?: Arg): Promise<T>; locator(selector: string): Locator; waitForTimeout(ms: number): Promise<void>; screenshot(options: { path: string }): Promise<void>; close(): Promise<void>; context(): { newCDPSession(page: Page): Promise<Cdp> }; on(event: "console" | "pageerror", listener: (message: { text?(): string; message?: string }) => void): void };
type Locator = { boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> };
type Cdp = { send(method: string, params: Record<string, unknown>): Promise<unknown> };
type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

const browserCandidates = process.platform === "darwin"
  ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
  : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const executablePath = [process.env.FUSION_BROWSER_SMOKE_BROWSER, process.env.CHROME_BIN, ...browserCandidates].find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate));
const screenshots = path.resolve(process.cwd(), "e2e/__screenshots__/fn-8602");

async function touchDrag(cdp: Cdp, point: Point, delta = { x: 48, y: 36 }) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, id: 1 }] });
  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x + delta.x * fraction, y: point.y + delta.y * fraction, id: 1 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function setTabletMetrics(cdp: Cdp, width: number, height: number) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    screenWidth: width,
    screenHeight: height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
}

async function rect(page: Page, selector: string): Promise<Rect> {
  return page.evaluate((target) => {
    const panel = document.querySelector<HTMLElement>(target);
    if (!panel) throw new Error(`Missing ${target}`);
    const { x, y, width, height } = panel.getBoundingClientRect();
    return { x, y, width, height };
  }, selector);
}

async function targetCenter(page: Page, selector: string): Promise<Point> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`Missing resize target ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/*
FNXC:TaskModalResize 2026-08-12-15:12:
Browser CDP gestures are required because jsdom cannot resolve CSS hit targets. This fixture mounts
both production resize paths and sends CSS-pixel touch input through Chromium so elementFromPoint,
pointer capture, persistence, and header-drag isolation use the same browser input path.
*/
describe.runIf(executablePath)("Task modal tablet touch resize browser regression", () => {
  let server: ViteDevServer; let browser: Browser; let baseUrl = "";
  beforeAll(async () => {
    server = await createServer({ root: process.cwd(), server: { host: "127.0.0.1", port: 0, watch: null }, logLevel: "error" });
    await server.listen(); baseUrl = server.resolvedUrls?.local[0] ?? "";
    browser = await chromium.launch({ executablePath, headless: true, ...(process.env.CI ? { args: ["--no-sandbox", "--disable-dev-shm-usage"] } : {}) });
  }, 30_000);
  afterAll(async () => {
    await browser?.close();
    await server?.watcher.close();
    server?.ws.close();
    server?.httpServer?.closeAllConnections?.();
    await new Promise<void>((resolve) => server?.httpServer?.close(() => resolve()));
    await server?.pluginContainer.close();
  }, 15_000);

  for (const [width, height] of [[768, 1024], [820, 1180]] as const) {
    it(`hits and resizes Task Detail and New Task at the ${width}px tablet boundary with CDP touch`, async () => {
      const page = await browser.newPage({ viewport: { width, height } });
      const cdp = await page.context().newCDPSession(page);
      await setTabletMetrics(cdp, width, height);
      page.on("console", (message) => console.log(`[task-modal-touch-resize] ${message.text?.() ?? ""}`));
      page.on("pageerror", (message) => console.error(`[task-modal-touch-resize] ${message.message ?? ""}`));
      await page.goto(`${baseUrl}app/task-modal-touch-resize-e2e-fixture.html?surface=task-detail&reset=1`);
      await page.waitForTimeout(350);
      expect(await page.evaluate(() => window.scrollX === 0 && window.scrollY === 0)).toBe(true);
      expect(await page.evaluate(() => document.querySelectorAll("[data-resize-hit-target='true']").length)).toBe(1);
      await mkdir(screenshots, { recursive: true });
      if (width === 820) await page.screenshot({ path: path.join(screenshots, "tablet-before.png") });

      const detailSelector = "[data-testid='task-detail-modal'] .modal-resize-grip";
      const detailPoint = await targetCenter(page, detailSelector);
      expect(await page.evaluate((point) => document.elementFromPoint(point.x, point.y)?.getAttribute("data-resize-hit-target"), detailPoint)).toBe("true");
      const detailBefore = await rect(page, "[data-testid='task-detail-modal']");
      await touchDrag(cdp, detailPoint);
      await page.waitForTimeout(250);
      const detailAfter = await rect(page, "[data-testid='task-detail-modal']");
      expect(detailAfter.width).toBeGreaterThan(detailBefore.width);
      expect(detailAfter.height).toBeGreaterThan(detailBefore.height);
      expect(detailAfter.width).toBeLessThanOrEqual(width);
      expect(detailAfter.height).toBeLessThanOrEqual(height);
      expect(await page.evaluate(() => localStorage.getItem("task-detail-modal-size"))).not.toBeNull();

      await page.goto(`${baseUrl}app/task-modal-touch-resize-e2e-fixture.html?surface=new-task`);
      await page.waitForTimeout(350);
      expect(await page.evaluate(() => document.querySelectorAll("[data-resize-hit-target='true']").length)).toBe(8);
      const newTaskPanel = ".new-task-modal";
      const headerPoint = await targetCenter(page, "[data-testid='new-task-drag-handle']");
      const newTaskBeforeHeaderDrag = await rect(page, newTaskPanel);
      await touchDrag(cdp, headerPoint, { x: 32, y: 28 });
      await page.waitForTimeout(100);
      const newTaskAfterHeaderDrag = await rect(page, newTaskPanel);
      expect(newTaskAfterHeaderDrag.x).not.toBe(newTaskBeforeHeaderDrag.x);
      expect(newTaskAfterHeaderDrag.y).not.toBe(newTaskBeforeHeaderDrag.y);
      expect(newTaskAfterHeaderDrag.width).toBe(newTaskBeforeHeaderDrag.width);
      expect(newTaskAfterHeaderDrag.height).toBe(newTaskBeforeHeaderDrag.height);

      const newTaskTarget = "[data-testid='new-task-resize-se']";
      const newTaskPoint = await targetCenter(page, newTaskTarget);
      expect(await page.evaluate((point) => document.elementFromPoint(point.x, point.y)?.getAttribute("data-resize-hit-target"), newTaskPoint)).toBe("true");
      const newTaskBeforeResize = await rect(page, newTaskPanel);
      await touchDrag(cdp, newTaskPoint);
      await page.waitForTimeout(100);
      const newTaskAfterResize = await rect(page, newTaskPanel);
      expect(newTaskAfterResize.width).toBeGreaterThan(newTaskBeforeResize.width);
      expect(newTaskAfterResize.height).toBeGreaterThan(newTaskBeforeResize.height);
      expect(newTaskAfterResize.width).toBeLessThanOrEqual(width - 32);
      expect(newTaskAfterResize.height).toBeLessThanOrEqual(height - 32);
      expect(await page.evaluate(() => localStorage.getItem("fusion:new-task-modal-size"))).not.toBeNull();
      expect(await page.evaluate(() => localStorage.getItem("fusion:new-task-modal-position"))).not.toBeNull();
      if (width === 820) await page.screenshot({ path: path.join(screenshots, "tablet-after.png") });
      await page.close();
    }, 30_000);
  }

  it("keeps the true-phone sheet free of active resize targets", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await page.goto(`${baseUrl}app/task-modal-touch-resize-e2e-fixture.html?reset=1`);
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.querySelector("[data-resize-hit-target]") === null)).toBe(true);
    expect(await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".new-task-modal");
      return panel ? panel.getBoundingClientRect().height >= window.innerHeight * 0.9 : false;
    })).toBe(true);
    await page.screenshot({ path: path.join(screenshots, "phone-fullscreen.png") });
    await page.close();
  }, 30_000);
});
