import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CursorCliProviderCard } from "../CursorCliProviderCard";

const fetchCursorCliStatus = vi.fn();
const setCursorCliBinaryPath = vi.fn();
const setCursorCliEnabled = vi.fn();

vi.mock("../../api", () => ({
  fetchCursorCliStatus: (...args: unknown[]) => fetchCursorCliStatus(...args),
  setCursorCliBinaryPath: (...args: unknown[]) => setCursorCliBinaryPath(...args),
  setCursorCliEnabled: (...args: unknown[]) => setCursorCliEnabled(...args),
}));

const baseStatus = {
  binary: { available: true, version: "1.0.0", binaryPath: "/home/fusion/.local/bin/cursor-agent", probeDurationMs: 5 },
  enabled: true,
  binaryPath: "/home/fusion/.local/bin/cursor-agent",
  extension: null,
  ready: true,
};

/*
FNXC:SettingsNonIdentityAutofill 2026-07-31-12:20:
ISS-UI-001 expanded regression: Cursor CLI binary path must not accept browser email
injection before focus, and Save & Test must stay disabled without an explicit edit.
*/
describe("CursorCliProviderCard ISS-UI-001 path autofill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCursorCliStatus.mockResolvedValue(baseStatus);
    setCursorCliEnabled.mockResolvedValue({ enabled: true, binaryPath: baseStatus.binaryPath, restartRequired: true });
    setCursorCliBinaryPath.mockResolvedValue({ enabled: true, binaryPath: baseStatus.binaryPath, restartRequired: true });
  });

  it("starts with the configured path and non-identity attributes", async () => {
    render(<CursorCliProviderCard authenticated compact />);
    const input = await screen.findByLabelText("Cursor CLI binary path");
    await waitFor(() => expect(input).toHaveValue("/home/fusion/.local/bin/cursor-agent"));
    expect(input).toHaveAttribute("id", "cursor-cli-binary-path");
    expect(input).toHaveAttribute("name", "cursor-cli-binary-path");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: /Save & Test/i })).toBeDisabled();
  });

  it("ignores DOM email injection before focus and keeps Save & Test disabled", async () => {
    render(<CursorCliProviderCard authenticated compact />);
    const input = (await screen.findByLabelText("Cursor CLI binary path")) as HTMLInputElement;
    await waitFor(() => expect(input).toHaveValue("/home/fusion/.local/bin/cursor-agent"));

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    expect(nativeSetter).toBeTypeOf("function");
    act(() => {
      nativeSetter!.call(input, "anas966@gmail.com");
      fireEvent.change(input, { target: { value: "anas966@gmail.com" } });
    });
    expect(input).toHaveValue("/home/fusion/.local/bin/cursor-agent");
    expect(screen.getByRole("button", { name: /Save & Test/i })).toBeDisabled();
    expect(setCursorCliBinaryPath).not.toHaveBeenCalled();
  });

  it("allows explicit operator edits after focus and Save & Test", async () => {
    const user = userEvent.setup({ delay: null });
    render(<CursorCliProviderCard authenticated compact />);
    const input = await screen.findByLabelText("Cursor CLI binary path");
    await waitFor(() => expect(input).toHaveValue("/home/fusion/.local/bin/cursor-agent"));
    await user.click(input);
    await user.clear(input);
    await user.type(input, "/tmp/explicit-cursor-agent");
    expect(screen.getByRole("button", { name: /Save & Test/i })).not.toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Save & Test/i }));
    await waitFor(() => expect(setCursorCliBinaryPath).toHaveBeenCalledWith("/tmp/explicit-cursor-agent"));
  });
});
