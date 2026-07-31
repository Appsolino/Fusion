import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsModal } from "../SettingsModal";

/*
FNXC:SettingsSearchAutofill 2026-07-31-10:55:
ISS-UI-001 regression suite. These tests prove the Settings filter's empty start state,
non-identity attributes, clear/DOM+state reset, typed filtering, and Authentication
reachability after clear. They do NOT claim to reproduce Chrome/Edge password-manager
autofill against a saved browser profile — that remains a deployed browser acceptance check.
*/

const mockFetchSettings = vi.fn();
const mockFetchSettingsByScope = vi.fn();

vi.mock("../../api", async (importOriginal) => {
  const { createDashboardApiMock } = await import("../../test/mockApi");
  return createDashboardApiMock(() => importOriginal<typeof import("../../api")>(), {
    fetchSettings: (...args: unknown[]) => mockFetchSettings(...args),
    fetchSettingsByScope: (...args: unknown[]) => mockFetchSettingsByScope(...args),
  });
});

vi.mock("../../hooks/useMemoryBackendStatus", () => ({
  useMemoryBackendStatus: () => ({ status: null, capabilities: null, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("../../hooks/useViewportMode", () => ({
  MOBILE_MEDIA_QUERY: "(max-width: 768px), (max-height: 480px)",
  isFullScreenSheetViewport: () => false,
  isShortViewport: () => false,
  isTabletTouchViewport: (mode?: string) => mode === "tablet",
  useViewportMode: () => "desktop",
  getViewportMode: () => "desktop",
  isMobileViewport: () => false,
}));
vi.mock("../../hooks/useMobileKeyboard", () => ({
  useMobileKeyboard: () => ({ keyboardOverlap: 0, viewportHeight: null, viewportOffsetTop: 0, keyboardOpen: false }),
}));
vi.mock("../../hooks/useMobileScrollLock", () => ({
  useMobileScrollLock: vi.fn(),
  useMobileKeyboardViewportLock: vi.fn(),
  useMobileViewportRestoreReset: vi.fn(),
}));
vi.mock("../../hooks/useConfirm", () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock("../../hooks/useWorkspaceFileBrowser", () => ({
  useWorkspaceFileBrowser: () => ({ entries: [], currentPath: ".", setPath: vi.fn(), loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("../../hooks/useWorktrunkInstallStatus", () => ({
  useWorktrunkInstallStatus: () => ({ status: "idle", requestInstall: vi.fn() }),
}));

function buildSettings() {
  return {
    autoMerge: true,
    maxConcurrent: 2,
    maxWorktrees: 4,
    pollIntervalMs: 15000,
    heartbeatMultiplier: 1,
    groupOverlappingFiles: true,
    overlapIgnorePaths: [],
    mergeStrategy: "direct",
    mergeIntegrationWorktree: "reuse-task-worktree",
    recycleWorktrees: false,
    executorAllowSiblingBranchRename: false,
    worktreeNaming: "random",
    worktreesDir: "",
    worktrunk: { enabled: false, binaryPath: "", onFailure: "fail" },
    includeTaskIdInCommit: true,
    ntfyEnabled: false,
    failureNotificationMode: "sticky-only",
    failureNotificationDelayMs: 30000,
    webhookEnabled: false,
    experimentalFeatures: {},
  };
}

async function renderSettings() {
  const view = render(<SettingsModal onClose={vi.fn()} addToast={vi.fn()} initialSection="authentication" />);
  await waitFor(() => expect(mockFetchSettings).toHaveBeenCalled());
  await waitFor(() => {
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
  await waitFor(() => {
    expect(screen.getByTestId("settings-search-input")).toBeInTheDocument();
  });
  return view;
}

function getSearchInput(): HTMLInputElement {
  return screen.getByTestId("settings-search-input") as HTMLInputElement;
}

function getSettingsNavButtons(): HTMLElement[] {
  return screen.getAllByRole("button").filter((button) => button.classList.contains("settings-nav-item"));
}

describe("SettingsModal ISS-UI-001 search autofill protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockFetchSettings.mockResolvedValue(buildSettings());
    mockFetchSettingsByScope.mockResolvedValue({ global: {}, project: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the Settings search input empty on open", async () => {
    await renderSettings();
    const search = getSearchInput();
    expect(search).toHaveValue("");
    expect(screen.getByText("Showing all settings sections")).toBeInTheDocument();
  });

  it("uses search-specific id/name/autocomplete attributes that cannot be mistaken for email/username/login", async () => {
    await renderSettings();
    const search = getSearchInput();
    expect(search).toHaveAttribute("type", "search");
    expect(search).toHaveAttribute("id", "settings-filter");
    expect(search).toHaveAttribute("name", "settings-filter");
    expect(search).toHaveAttribute("autocomplete", "off");
    expect(search).toHaveAttribute("autocapitalize", "none");
    expect(search).toHaveAttribute("autocorrect", "off");
    expect(search).toHaveAttribute("spellcheck", "false");
    expect(search.id.toLowerCase()).not.toMatch(/email|user|login|password|username/);
    expect((search.getAttribute("name") ?? "").toLowerCase()).not.toMatch(/email|user|login|password|username/);
    expect(search.closest("form")).toHaveAttribute("autocomplete", "off");
    expect(search.closest("form")).toHaveAttribute("role", "search");
  });

  it("does not let a DOM-only browser injection permanently control filtering", async () => {
    await renderSettings();
    const search = getSearchInput();
    expect(search).toHaveAttribute("readonly");
    expect(screen.getByRole("heading", { name: "Authentication" })).toBeInTheDocument();

    // Simulate Chromium writing a restored email into the DOM without a React onChange (pre-focus autofill).
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    expect(nativeSetter).toBeTypeOf("function");
    act(() => {
      nativeSetter!.call(search, "owner@example.com");
    });
    // Force a React paint; controlled value must win over the native email write.
    fireEvent.click(screen.getByRole("checkbox", { name: "Advanced settings" }));
    expect(getSearchInput()).toHaveValue("");
    expect(screen.getByRole("heading", { name: "Authentication" })).toBeInTheDocument();
    expect(screen.getByText("Showing all settings sections")).toBeInTheDocument();
    expect(getSettingsNavButtons().some((button) => /Authentication/.test(button.textContent ?? ""))).toBe(true);
  });

  it("clears both the DOM value and application filter state", async () => {
    const user = userEvent.setup({ delay: null });
    await renderSettings();
    const search = getSearchInput();
    await user.click(search);
    await user.type(search, "zzzzzz-no-match");
    expect(search).toHaveValue("zzzzzz-no-match");
    expect(screen.getAllByText(/No settings sections match/).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: "Clear settings search" })[0]);
    expect(getSearchInput()).toHaveValue("");
    expect(screen.getByText("Showing all settings sections")).toBeInTheDocument();
    expect(getSearchInput()).toHaveAttribute("readonly");
  });

  it("still filters sections when the operator types a normal filter", async () => {
    const user = userEvent.setup({ delay: null });
    await renderSettings();
    const search = getSearchInput();
    await user.click(search);
    expect(search).not.toHaveAttribute("readonly");
    await user.type(search, "anthropic");
    expect(search).toHaveValue("anthropic");
    expect(getSettingsNavButtons().some((button) => /Authentication/.test(button.textContent ?? ""))).toBe(true);
    expect(getSettingsNavButtons().some((button) => /General · Project/.test(button.textContent ?? ""))).toBe(false);
  });

  it("keeps Authentication reachable after clearing a non-matching filter", async () => {
    const user = userEvent.setup({ delay: null });
    await renderSettings();
    const search = getSearchInput();
    await user.click(search);
    await user.type(search, "zzzzzz-no-match");
    await user.click(screen.getAllByRole("button", { name: "Clear settings search" })[0]);

    expect(getSearchInput()).toHaveValue("");
    expect(screen.getByText("Showing all settings sections")).toBeInTheDocument();
    const authNav = getSettingsNavButtons().find((button) => /Authentication/.test(button.textContent ?? ""));
    expect(authNav).toBeTruthy();
    fireEvent.click(authNav!);
    expect(screen.getByRole("heading", { name: "Authentication" })).toBeInTheDocument();
  });
});
