// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readAppFile } from "../../test/cssFixture";
import { QuestionForm } from "../PlanningModeModal";

afterEach(cleanup);

describe("PlanningModeModal sequential layout", () => {
  it("uses one persistent responsive plan-and-question workspace", () => {
    const css = readAppFile("components/PlanningModeModal.css");
    expect(css).not.toMatch(/planning-compact-pane-switcher|planning-answered-history/);
    expect(css).toContain("planning-workspace");
    expect(css).toContain('grid-template-areas: "question plan"');
    expect(css).toContain("planning-summary-actions");
  });

  it("captures selections only from the rendered plan and provides accessible comment controls", () => {
    const component = readAppFile("components/PlanningModeModal.tsx");
    expect(component).toContain("planDocumentRef.current");
    expect(component).toContain("root.contains(selection.anchorNode)");
    expect(component).toContain("root.contains(selection.focusNode)");
    expect(component).toContain('document.addEventListener("selectionchange", capturePlanSelection)');
    expect(component).toContain("selection.isCollapsed");
    expect(component).toContain("Add comment to selection");
    /*
    FNXC:PlanningComments 2026-07-25-10:20:
    Exactly one Add-comment trigger, in the plan action rail. The --document / --mobile variant pair
    rendered two buttons and must not come back.
    */
    expect(component).not.toContain("planning-add-comment--document");
    expect(component).not.toContain("planning-add-comment--mobile");
    expect(component.match(/className="btn planning-add-comment"/g)).toHaveLength(1);
    expect(component).toContain("addCommentTriggerRef");
    // FNXC:PlanningComments 2026-07-25-10:20: the control appears once the drag-selection is done, not per selectionchange.
    expect(component).toContain("planSelectionDragActiveRef");
    expect(component).toContain('document.addEventListener("pointerup", handlePointerRelease)');
    expect(component).toContain("contextualComments");
    expect(component).toContain("setContextualComments([])");
    // FNXC:PlanningComments 2026-07-24-06:20: prevent blur on pointerdown; commit on click.
    expect(component).toContain("handleMobileKeyboardActionPointerDown");
    expect(component).toContain("onPointerDown={handleMobileKeyboardActionPointerDown}");
    expect(component).toContain("onClick={handleAddContextualComment}");
    // FNXC:PlanningComments 2026-07-24-06:30: freeze quote on open so selection collapse cannot unmount the editor.
    expect(component).toContain("openCommentEditor");
    expect(component).toContain("openCommentQuote");
    expect(component).toContain("pendingOpenCommentQuoteRef");
  });

  it("renders four normalized choices plus one Other without duplicate rows", () => {
    const onSubmit = vi.fn();
    render(<QuestionForm
      question={{
        id: "direction",
        type: "single_select",
        question: "Which direction should we take?",
        options: [
          { id: "speed", label: "Ship quickly", description: "Deliver a focused version.", pros: ["Fast"], cons: ["Narrow"] },
          { id: "reliable", label: "Prioritize reliability", description: "Build safeguards first.", pros: ["Safe"], cons: ["Slow"] },
          { id: "scope", label: "Reduce scope", description: "Deliver the essentials only.", pros: ["Small"], cons: ["Later"] },
          { id: "learn", label: "Investigate first", description: "Research before deciding.", pros: ["Informed"], cons: ["Delayed"] },
          { id: "speed", label: "Duplicate ID", description: "Must not render.", pros: [""], cons: [""] },
          { id: "other", label: "Duplicate Other", isOther: true },
        ],
      }}
      onSubmit={onSubmit}
    />);

    for (const label of ["Ship quickly", "Prioritize reliability", "Reduce scope", "Investigate first", "Other (write your own)"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText("Duplicate ID")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    fireEvent.click(screen.getByRole("radio", { name: /reduce scope/i }));
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ direction: "scope" });
  });

  it("keeps plan actions in a non-scrolling sibling footer with equal mobile columns", () => {
    const css = readAppFile("components/PlanningModeModal.css");
    expect(css).toMatch(/\.planning-actions\s*\{[^}]*flex-shrink\s*:\s*0\s*;/);
    expect(css).toMatch(/\.planning-plan-actions\s*\{[^}]*justify-content\s*:\s*flex-end\s*;[^}]*gap\s*:\s*var\(--space-lg\)\s*;[^}]*padding\s*:\s*var\(--space-md\) var\(--space-xl\) var\(--space-sm\)\s*;/);
    expect(css).toMatch(/@media \(max-width: 1024px\)[\s\S]*?\.planning-plan-actions\s*\{[^}]*display\s*:\s*grid\s*;[^}]*grid-template-columns\s*:\s*repeat\(2, minmax\(0, 1fr\)\)\s*;[^}]*gap\s*:\s*var\(--space-md\)\s*;[^}]*calc\(var\(--space-sm\) \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/@media \(max-width: 1024px\)[\s\S]*?\.planning-plan-actions \.btn\s*\{[^}]*width\s*:\s*100%\s*;/);
    expect(css).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.planning-plan-actions\s*\{[^}]*gap\s*:\s*var\(--space-md\)\s*;[^}]*calc\(var\(--space-sm\) \+ env\(safe-area-inset-bottom\)\)/);
    // FNXC:PlanningComments 2026-07-25-10:20: one trigger everywhere — no breakpoint hides or duplicates it.
    expect(css).not.toMatch(/planning-add-comment--(document|mobile)/);
    expect(css).toMatch(/\.planning-add-comment\s*\{[^}]*display\s*:\s*inline-flex\s*;/);
    expect(css).toMatch(/@media \(max-width: 1024px\)[\s\S]*?\.planning-plan-actions \.btn\.planning-add-comment\s*\{[^}]*display\s*:\s*flex\s*;[^}]*grid-column\s*:\s*1\s*\/\s*-1\s*;/);
    expect(css).not.toMatch(/@media \(max-width: 768px\)[\s\S]*?\.planning-plan-actions \.btn\.planning-add-comment\s*\{[^}]*position\s*:\s*fixed\s*;/);
    expect(css).toMatch(/@media \(max-width: 1024px\)[\s\S]*?\.planning-comment-editor\s*\{[^}]*position\s*:\s*fixed\s*;/);
  });
});
