import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FloatingWindow } from "../FloatingWindow";
import { migratedModalFixtures } from "./migratedModalFixtures";

const fixtures = migratedModalFixtures.filter((fixture) => fixture.key && fixture.name.includes("Agent"));

/* FNXC:ModalTouchGeometry 2026-07-26-18:55: Exercise every agent geometry identity against the shared host; the modal prop is deliberate because these were formerly page-blocking dialogs. */
describe("agent modal FloatingWindow behavior", () => {
  it.each(fixtures)("$name exposes modal drag, eight-way resize, and persisted geometry", (fixture) => {
    const close = vi.fn();
    render(<FloatingWindow modal windowKey={fixture.key!} title={fixture.name} onClose={close} defaultSize={{ width: 320, height: 240 }} defaultPosition={{ x: 80, y: 80 }} persistGeometryKey={fixture.key!}><button>action</button></FloatingWindow>);
    const host = screen.getByTestId(`floating-window-overlay-${fixture.key}`);
    expect(host).toHaveAttribute("aria-modal", "true");
    const panel = screen.getByTestId(`floating-window-${fixture.key}`);
    const drag = screen.getByTestId(`floating-window-drag-handle-${fixture.key}`);
    Object.defineProperty(drag, "setPointerCapture", { configurable: true, value: vi.fn() });
    Object.defineProperty(drag, "releasePointerCapture", { configurable: true, value: vi.fn() });
    fireEvent.pointerDown(drag, { pointerType: "touch", pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(drag, { pointerType: "touch", pointerId: 1, clientX: 120, clientY: 130 });
    fireEvent.pointerUp(drag, { pointerType: "touch", pointerId: 1, clientX: 120, clientY: 130 });
    expect(panel.style.left).toBe("100px");
    for (const direction of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) expect(screen.getByTestId(`floating-window-resize-${direction}`)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(fixture.key!) ?? "{}")).toHaveProperty("position");
  });
});
