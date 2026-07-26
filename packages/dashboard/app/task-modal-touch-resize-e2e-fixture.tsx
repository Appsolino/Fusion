import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import "./styles.css";
import "./components/TaskDetailModal.css";
import "./components/FloatingWindow.css";
import { FloatingWindow } from "./components/FloatingWindow";
import { useModalResizePersist } from "./hooks/useModalResizePersist";
import { isTabletTouchViewport, useViewportMode } from "./hooks/useViewportMode";
import { NewTaskModal } from "./components/NewTaskModal";
import { ConfirmDialogProvider } from "./hooks/useConfirm";

const params = new URLSearchParams(window.location.search);
const surface = params.get("surface") ?? "new-task";
if (params.has("reset")) localStorage.clear();

/*
FNXC:TaskModalResize 2026-07-26-16:00:
The browser fixture seeds the production persistence path only for resize gestures that need
headroom. It never supplies inline panel geometry, so density assertions continue to exercise
TaskDetailModal.css's real tablet overlay and width rules.
*/
const detailSize = params.get("detailSize");
if (detailSize) {
  const [width, height] = detailSize.split("x").map(Number);
  if (Number.isFinite(width) && Number.isFinite(height)) {
    localStorage.setItem("task-detail-modal-size", JSON.stringify({ width, height }));
  }
}

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { app: {} } },
  interpolation: { escapeValue: false },
});

// Browser fixtures provide the production form's minimal typed API payloads. The resize assertions
// exercise NewTaskModal itself rather than an API-dependent form failure.
window.fetch = async (input) => {
  const url = String(input);
  const payload = url.includes("/models")
    ? { models: [], favoriteProviders: [], favoriteModels: [] }
    : url.includes("/settings") ? {}
      : [];
  return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
};

function TaskDetailResizeHarness() {
  const ref = useRef<HTMLDivElement>(null);
  const viewportMode = useViewportMode();
  const touchTargets = isTabletTouchViewport(viewportMode);
  useModalResizePersist(ref, true, "task-detail-modal-size", { touchTargets });
  return <div className="modal-overlay open">
    <div ref={ref} className={`modal modal-lg task-detail-modal${viewportMode === "tablet" ? " task-modal--tablet" : ""}${touchTargets ? " task-modal--touch-resize" : ""}`} data-testid="task-detail-modal">
      <div className="task-detail-content"><div className="modal-header">Task detail</div><div className="modal-body">Task detail body</div></div>
    </div>
  </div>;
}

function FloatingWindowHarness() {
  return <FloatingWindow
    windowKey="fn-8605-floating"
    title="Floating task detail"
    onClose={() => undefined}
    className="floating-window--task-detail"
    defaultSize={{ width: 560, height: 480 }}
    defaultPosition={{ x: 80, y: 80 }}
    minSize={{ width: 320, height: 240 }}
    persistGeometryKey="fusion:fn-8605-floating"
    suspendGeometryPersistenceOnMobile
  >
    <div>Floating task detail body</div>
  </FloatingWindow>;
}

function HeaderlessFloatingWindowHarness() {
  const [actionCount, setActionCount] = useState(0);
  return <FloatingWindow
    windowKey="fn-8605-headerless-floating"
    title="Headerless floating task detail"
    onClose={() => undefined}
    hideHeader
    dragHandleSelector=".fn-8605-delegated-drag-handle"
    className="floating-window--task-detail"
    defaultSize={{ width: 560, height: 480 }}
    defaultPosition={{ x: 80, y: 80 }}
    minSize={{ width: 320, height: 240 }}
    persistGeometryKey="fusion:fn-8605-headerless-floating"
    suspendGeometryPersistenceOnMobile
  >
    <div className="fn-8605-delegated-drag-handle">Headerless task detail
      <button type="button" data-testid="fn-8605-header-action" onClick={() => setActionCount((count) => count + 1)}>Header action</button>
      <output data-testid="fn-8605-header-action-count">{actionCount}</output>
    </div>
    <div>Floating task detail body</div>
  </FloatingWindow>;
}

/*
FNXC:ModalTouchGeometry 2026-07-26-15:30:
This intentionally classless headerless window is the browser control for every non-task
FloatingWindow consumer. It must retain the shared 44px layout target while task detail moves
its target out of flow.
*/
function GenericFloatingWindowHarness() {
  return <FloatingWindow
    windowKey="fn-8612-generic-floating"
    title="Generic floating window"
    onClose={() => undefined}
    hideHeader
    dragHandleSelector=".fn-8612-generic-drag-handle"
    defaultSize={{ width: 560, height: 480 }}
    defaultPosition={{ x: 80, y: 80 }}
    minSize={{ width: 320, height: 240 }}
    persistGeometryKey="fusion:fn-8612-generic-floating"
    suspendGeometryPersistenceOnMobile
  >
    <div className="fn-8612-generic-drag-handle">Generic window header</div>
    <div>Generic floating window body</div>
  </FloatingWindow>;
}

function Fixture() {
  return <I18nextProvider i18n={i18n}>
    <ConfirmDialogProvider skipConfirmations>
      {surface === "floating-window" ? <FloatingWindowHarness /> : surface === "floating-window-headerless" ? <HeaderlessFloatingWindowHarness /> : surface === "floating-window-generic" ? <GenericFloatingWindowHarness /> : surface === "task-detail" ? <TaskDetailResizeHarness /> : <NewTaskModal
        isOpen
        tasks={[]}
        onClose={() => undefined}
        onCreateTask={async () => ({ id: "FN-E2E" }) as never}
        addToast={() => undefined}
      />}
    </ConfirmDialogProvider>
  </I18nextProvider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
