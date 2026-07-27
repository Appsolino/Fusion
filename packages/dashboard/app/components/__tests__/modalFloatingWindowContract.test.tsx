import { describe, expect, it } from "vitest";
import { readAppFile } from "../../test/cssFixture";
import { migratedModalFixtures } from "./migratedModalFixtures";

/* FNXC:ModalTouchGeometry 2026-07-26-18:49: Keep the inventory decision in one executable table: a non-trivial static dialog needs a reason, while every hosted dialog must keep both sheet safeguards. */
describe("FN-8607 migrated modal FloatingWindow contract", () => {
  it.each(migratedModalFixtures.filter((fixture) => !fixture.optOut))("hosts $name with persistent, blocking tablet geometry", (fixture) => {
    const source = readAppFile(`components/${fixture.file}`);
    expect(source).toContain("<FloatingWindow");
    expect(source).toContain(`persistGeometryKey=\"${fixture.key}\"`);
    expect(source).toContain("suspendGeometryPersistenceOnMobile");
    expect(source).toContain("suspendGeometryPersistenceOnShortViewport");
    expect(source).toContain("dragHandleSelector");
    expect(source).toContain(" modal");
    expect(source.includes("closeOnOutsidePointerDown")).toBe(fixture.outside);
  });

  it.each(migratedModalFixtures.filter((fixture) => fixture.optOut))("keeps $name as justified inventory opt-out", (fixture) => {
    const source = readAppFile(`components/${fixture.file}`);
    expect(source).not.toContain("<FloatingWindow");
    expect(fixture.optOut).toMatch(/.+/);
  });

  it("uses modal isolation instead of the utility host click-through mode", () => {
    const source = readAppFile("components/FloatingWindow.tsx");
    expect(source).toContain('aria-modal={modal ? "true" : "false"}');
    expect(source).toContain("floating-window-overlay--modal");
    expect(readAppFile("components/FloatingWindow.css")).toContain(".floating-window-overlay--modal");
  });
});
