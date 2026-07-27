import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FloatingWindow } from "../FloatingWindow";
import { migratedModalFixtures } from "./migratedModalFixtures";

const fixtures = migratedModalFixtures.filter((fixture) => fixture.key && /Setup|Native|Docker/.test(fixture.name));

describe("onboarding modal FloatingWindow behavior", () => {
  it.each(fixtures)("$name keeps a blocking focus boundary and geometry handles", (fixture) => {
    render(<FloatingWindow modal windowKey={fixture.key!} title={fixture.name} onClose={vi.fn()} defaultSize={{ width: 320, height: 240 }} defaultPosition={{ x: 80, y: 80 }} persistGeometryKey={fixture.key!}><button>first</button><button>last</button></FloatingWindow>);
    const host = screen.getByTestId(`floating-window-overlay-${fixture.key}`);
    const panel = screen.getByTestId(`floating-window-${fixture.key}`);
    expect(host).toHaveAttribute("aria-modal", "true");
    expect(panel).toHaveAttribute("tabindex", "-1");
    expect(screen.getAllByLabelText("Resize floating window")).toHaveLength(8);
    expect(localStorage.getItem(fixture.key!)).not.toBeNull();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(panel.contains(document.activeElement)).toBe(true);
  });
});
