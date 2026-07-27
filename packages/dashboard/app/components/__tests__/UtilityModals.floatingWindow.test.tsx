import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FloatingWindow } from "../FloatingWindow";
import { migratedModalFixtures } from "./migratedModalFixtures";

const fixtures = migratedModalFixtures.filter((fixture) => fixture.key && /Mailbox|Milestone|Subtask/.test(fixture.name));

describe("utility modal FloatingWindow behavior", () => {
  it.each(fixtures)("$name blocks page clicks while preserving outside-dismiss choice", (fixture) => {
    const close = vi.fn();
    render(<><button data-testid="page-control">page</button><FloatingWindow modal windowKey={fixture.key!} title={fixture.name} onClose={close} defaultSize={{ width: 320, height: 240 }} defaultPosition={{ x: 80, y: 80 }} persistGeometryKey={fixture.key!} closeOnOutsidePointerDown={fixture.outside}><button>inside</button></FloatingWindow></>);
    const host = screen.getByTestId(`floating-window-overlay-${fixture.key}`);
    expect(host).toHaveAttribute("aria-modal", "true");
    expect(screen.getAllByLabelText("Resize floating window")).toHaveLength(8);
    fireEvent.pointerDown(document.body, { pointerType: "mouse" });
    if (fixture.outside) expect(close).toHaveBeenCalledOnce(); else expect(close).not.toHaveBeenCalled();
  });
});
