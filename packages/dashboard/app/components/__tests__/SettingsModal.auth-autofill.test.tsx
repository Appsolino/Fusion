import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsModal } from "../SettingsModal";

/*
FNXC:SettingsNonIdentityAutofill 2026-07-31-12:20:
ISS-UI-001 API-key Replace flow: stored keys must not mount an editable password
input until Replace; pre-Replace password injection must not enter React state.
*/

const mockFetchSettings = vi.fn();
const mockFetchSettingsByScope = vi.fn();
const mockFetchAuthStatus = vi.fn();
const mockSaveApiKey = vi.fn();
const mockClearApiKey = vi.fn();
const mockFetchCursorCliStatus = vi.fn();

vi.mock("../../api", async (importOriginal) => {
  const { createDashboardApiMock } = await import("../../test/mockApi");
  return createDashboardApiMock(() => importOriginal<typeof import("../../api")>(), {
    fetchSettings: (...args: unknown[]) => mockFetchSettings(...args),
    fetchSettingsByScope: (...args: unknown[]) => mockFetchSettingsByScope(...args),
    fetchAuthStatus: (...args: unknown[]) => mockFetchAuthStatus(...args),
    saveApiKey: (...args: unknown[]) => mockSaveApiKey(...args),
    clearApiKey: (...args: unknown[]) => mockClearApiKey(...args),
    fetchCursorCliStatus: (...args: unknown[]) => mockFetchCursorCliStatus(...args),
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

async function renderAuthSettings() {
  render(<SettingsModal onClose={vi.fn()} addToast={vi.fn()} initialSection="authentication" />);
  await waitFor(() => expect(mockFetchSettings).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
}

describe("Settings Authentication ISS-UI-001 API-key autofill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockFetchSettings.mockResolvedValue(buildSettings());
    mockFetchSettingsByScope.mockResolvedValue({ global: {}, project: {} });
    mockSaveApiKey.mockResolvedValue({ success: true });
    mockClearApiKey.mockResolvedValue({ success: true });
    mockFetchCursorCliStatus.mockResolvedValue({
      binary: { available: true, version: "1.0.0", binaryPath: "/home/fusion/.local/bin/cursor-agent", probeDurationMs: 5 },
      enabled: true,
      binaryPath: "/home/fusion/.local/bin/cursor-agent",
      extension: null,
      ready: true,
    });
  });

  it("does not render an editable password field for a stored API key until Replace", async () => {
    mockFetchAuthStatus.mockResolvedValue({
      providers: [{ id: "deepseek", name: "DeepSeek", authenticated: true, type: "api_key", keyHint: "sk-•••••abcd" }],
    });
    await renderAuthSettings();
    const card = screen.getByTestId("auth-provider-icon-deepseek").closest(".auth-provider-card") as HTMLElement;
    expect(within(card).getByTestId("auth-apikey-stored-deepseek")).toBeInTheDocument();
    expect(within(card).queryByPlaceholderText("Enter API key")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("opens an empty non-login API-key input only after Replace", async () => {
    const user = userEvent.setup({ delay: null });
    mockFetchAuthStatus.mockResolvedValue({
      providers: [{ id: "deepseek", name: "DeepSeek", authenticated: true, type: "api_key", keyHint: "sk-•••••abcd" }],
    });
    await renderAuthSettings();
    const card = screen.getByTestId("auth-provider-icon-deepseek").closest(".auth-provider-card") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Replace" }));
    const input = within(card).getByTestId("settings-api-key-deepseek") as HTMLInputElement;
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("autocomplete", "new-password");
    expect(input).toHaveAttribute("name", "settings-api-key-deepseek");
    expect(input).toHaveAttribute("readonly");
  });

  it("ignores password injection before Replace unlocks the field", async () => {
    mockFetchAuthStatus.mockResolvedValue({
      providers: [{ id: "deepseek", name: "DeepSeek", authenticated: true, type: "api_key", keyHint: "sk-•••••abcd" }],
    });
    await renderAuthSettings();
    const card = screen.getByTestId("auth-provider-icon-deepseek").closest(".auth-provider-card") as HTMLElement;
    expect(within(card).queryByPlaceholderText("Enter API key")).not.toBeInTheDocument();
    // No password input exists to inject into; Save must not have been given injected state.
    expect(mockSaveApiKey).not.toHaveBeenCalled();
  });

  it("ignores password injection before focus after Replace", async () => {
    const user = userEvent.setup({ delay: null });
    mockFetchAuthStatus.mockResolvedValue({
      providers: [{ id: "deepseek", name: "DeepSeek", authenticated: true, type: "api_key", keyHint: "sk-•••••abcd" }],
    });
    await renderAuthSettings();
    const card = screen.getByTestId("auth-provider-icon-deepseek").closest(".auth-provider-card") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Replace" }));
    const input = within(card).getByTestId("settings-api-key-deepseek") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "injected-password" } });
    });
    expect(input).toHaveValue("");
    expect(mockSaveApiKey).not.toHaveBeenCalled();
  });

  it("saves an explicitly typed replacement API key", async () => {
    const user = userEvent.setup({ delay: null });
    mockFetchAuthStatus.mockResolvedValue({
      providers: [{ id: "deepseek", name: "DeepSeek", authenticated: true, type: "api_key", keyHint: "sk-•••••abcd" }],
    });
    await renderAuthSettings();
    const card = screen.getByTestId("auth-provider-icon-deepseek").closest(".auth-provider-card") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Replace" }));
    const input = within(card).getByTestId("settings-api-key-deepseek");
    await user.click(input);
    await user.type(input, "sk-explicit-new");
    await user.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockSaveApiKey).toHaveBeenCalledWith("deepseek", "sk-explicit-new"));
  });

  it("keeps Authentication heading reachable alongside Cursor path", async () => {
    mockFetchAuthStatus.mockResolvedValue({
      providers: [
        { id: "cursor-cli", name: "Cursor — via Cursor CLI", authenticated: true, type: "cli" },
        { id: "deepseek", name: "DeepSeek", authenticated: true, type: "api_key", keyHint: "sk-•••••abcd" },
      ],
    });
    await renderAuthSettings();
    expect(screen.getByRole("heading", { name: "Authentication" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Cursor CLI binary path")).toHaveValue("/home/fusion/.local/bin/cursor-agent");
    expect(screen.getByTestId("settings-search-input")).toHaveValue("");
  });
});
