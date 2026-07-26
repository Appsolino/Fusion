import { useCallback, useEffect, useRef, useState } from "react";
import type { ThemeMode } from "@fusion/core";
import type { ProjectInfo } from "../api";
import { getScopedItem, scopedKey, setScopedItem } from "../utils/projectStorage";
import { getPluginViewId, isPluginViewId, isPluginViewRegistered } from "../plugins/pluginViewRegistry";
import { recordActivity } from "../utils/report-capture";

export type ViewMode = "overview" | "project";
/*
FNXC:ViewState 2026-06-22-00:00:
Workflows, Import Tasks, and Automations are promoted to top-level main-content task views (left-sidebar destinations) instead of modal-only overlays, so they render in the main panel like Command Center.
*/
export type BuiltInTaskView = "board" | "list" | "graph" | "agents" | "missions" | "chat" | "documents" | "research" | "evals" | "ideation" | "goalsView" | "todos" | "planning" | "skills" | "mailbox" | "insights" | "memory" | "command-center" | "secrets" | "devserver" | "dev-server" | "pull-requests" | "workflows" | "import-tasks" | "automations" | "settings" | "task-detail";
export type PluginTaskView = `plugin:${string}:${string}`;
export type TaskView = BuiltInTaskView | PluginTaskView;

const BUILT_IN_TASK_VIEWS: readonly BuiltInTaskView[] = [
  "board",
  "list",
  "graph",
  "agents",
  "missions",
  "chat",
  "documents",
  "research",
  "evals",
  /*
  FNXC:Navigation 2026-08-01-00:00:
  FN-8352 promotes Ideation from a Command Center tab to a persisted,
  default-off experimental top-level view.
  */
  "ideation",
  "goalsView",
  /*
  FNXC:ViewState 2026-06-21-09:14:
  FN-6829 promotes project Todos from modal-only state into the persisted built-in task-view registry so dashboard navigation can dock it in the right content area.
  */
  "todos",
  /*
  FNXC:Navigation 2026-06-21-00:00:
  FN-6886 promotes Planning Mode into a persisted top-level docked task view instead of treating it as a modal-only overlay.
  */
  "planning",

  "skills",
  "mailbox",
  "insights",
  "memory",
  "command-center",
  "secrets",
  "devserver",
  "dev-server",
  "pull-requests",
  "workflows",
  "import-tasks",
  "automations",
  /*
  FNXC:ViewState 2026-06-22-00:00:
  Settings is promoted from a modal-only overlay into a top-level main-content task view so the header/sidebar Settings entry points dock it in the main panel like Command Center, while preserving deep-link section navigation.
  */
  "settings",
  /*
  FNXC:Navigation 2026-06-22-00:00:
  Clicking a task card on the Board opens its detail as a full main-content view ("Full main panel (replaces board)") with a Back-to-board button, instead of the TaskDetailModal overlay. The detail is hosted under this registered `task-detail` task view so navigation/persistence treat it like any other docked main-panel destination.
  */
  "task-detail",
];

function isBuiltInTaskView(value: string | null): value is BuiltInTaskView {
  return value !== null && BUILT_IN_TASK_VIEWS.includes(value as BuiltInTaskView);
}

function isTaskView(value: string | null): value is TaskView {
  return value !== null && (isBuiltInTaskView(value) || isPluginViewId(value));
}

const LEGACY_ROADMAPS_PLUGIN_VIEW = getPluginViewId("fusion-plugin-roadmap", "roadmaps");

function normalizeTaskView(value: TaskView): TaskView {
  return value === "devserver" ? "dev-server" : value;
}

/*
FNXC:ViewState 2026-06-22-15:30:
Fusion must land on the Board on load, never the Command Center "Dashboard" view. A persisted/normalized `command-center` value resolves to `board` for the auto-restored landing view only (initializer + project-hydration effect). Deep links (`?view=command-center`) and explicit user navigation still reach the Command Center — this only governs the restored landing surface.

FNXC:ViewState 2026-07-07-00:00:
FN-7649: an auto-restored/hydrated landing surface must never be Settings either. Once a project's per-project persisted `kb-dashboard-task-view` becomes `settings` (a common state after configuring a project through Settings), switching projects re-hydrates that scoped value and — without this guard — restores straight to Settings instead of the Board. `settings`, like `command-center`, now resolves to `board` for the auto-restored landing view only (initializer + project-hydration effect). Deep links (`?view=settings`) and explicit header/sidebar navigation to Settings still work because the `?view=` URL effect and `setTaskView`/`handleChangeTaskView` paths use `normalizeTaskView`, not this guard.
*/
function resolveLandingTaskView(value: TaskView): TaskView {
  return value === "command-center" || value === "settings" ? "board" : value;
}

/*
FNXC:ViewState 2026-07-26-10:35:
Mobile browsers DISCARD a backgrounded dashboard tab and reload it when the user returns. That reload is indistinguishable from a fresh boot to `localStorage`, so the landing-view guard above bounced an operator who was reading Command Center or Settings back to the Board every time they took a phone call — losing their place through no action of their own.
The two cases ARE distinguishable by storage lifetime: `sessionStorage` is per-tab and survives reload AND discard-restore, but is never inherited by a newly opened tab. So a session-scoped copy of the live view means "this tab was already running and came back", while its absence means "genuinely fresh boot".
Deliberately conservative: the session copy bypasses `resolveLandingTaskView` ONLY on the first hydration of a tab that already had a view. A new tab, a cleared session, and every explicit project switch (`hasHydratedScopedTaskViewRef` already true) all keep the FN-7649 bounce to Board. The stored value is a view name only — never a URL, task id, or content.
*/
const SESSION_TASK_VIEW_KEY = "kb-dashboard-task-view-session";

/*
FNXC:ViewState 2026-07-26-10:44:
`task-detail` is the one view a same-tab restore must NOT reproduce: the detail's task snapshot is in-memory only, so a restored `task-detail` renders MainContent's empty-detail Board fallback — a Board wearing the wrong view name, which also suppresses the board scroll replay. Resolve it to `board` instead. A `?task=` deep link still re-opens the real detail on reload via useDeepLink.
*/
function resolveSessionTaskView(value: TaskView): TaskView {
  return value === "task-detail" ? "board" : normalizeTaskView(value);
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.sessionStorage;
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") return null;
    return storage;
  } catch {
    // Safari private mode / storage disabled: fall back to the fresh-boot landing behavior.
    return null;
  }
}

function getScopedSessionTaskView(projectId?: string): string | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  try {
    return storage.getItem(scopedKey(SESSION_TASK_VIEW_KEY, projectId));
  } catch {
    return null;
  }
}

function setScopedSessionTaskView(value: TaskView, projectId?: string): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(scopedKey(SESSION_TASK_VIEW_KEY, projectId), value);
  } catch {
    // Quota failures must never break navigation.
  }
}

function migrateLegacyRoadmapsView(value: string): TaskView {
  if (value !== "roadmaps") {
    return "board";
  }
  return isPluginViewRegistered("fusion-plugin-roadmap", "roadmaps") ? LEGACY_ROADMAPS_PLUGIN_VIEW : "board";
}

/*
FNXC:ViewState 2026-06-19-00:00:
FN-6702 removed the top-level Reliability task view after moving the page into Command Center. Persisted or linked legacy `reliability` values must land users on `command-center` instead of falling back to the board or becoming invalid.
*/
function migrateLegacyReliabilityView(value: string | null): TaskView | null {
  return value === "reliability" ? "command-center" : null;
}

/*
FNXC:ViewState 2026-06-21-00:00:
FN-6881 removed the standalone Stash Recovery task view after moving recovery into Git Manager. Persisted or linked `stash-recovery` values must land on Board instead of restoring an orphaned route.
*/
function migrateRetiredStashRecoveryView(value: string | null): TaskView | null {
  return value === "stash-recovery" ? "board" : null;
}

interface UseViewStateOptions {
  projectsLoading: boolean;
  projectsError: string | null;
  currentProjectLoading: boolean;
  currentProject: ProjectInfo | null;
  projectsLength: number;
  setupWizardOpen: boolean;
  openSetupWizard: () => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}

export interface UseViewStateResult {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  taskView: TaskView;
  setTaskView: (view: TaskView) => void;
  handleChangeTaskView: (newView: TaskView) => void;
  handleToggleTheme: () => void;
}

export function useViewState(options: UseViewStateOptions): UseViewStateResult {
  const {
    projectsLoading,
    currentProjectLoading,
    currentProject,
    themeMode,
    setThemeMode,
  } = options;

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem("kb-dashboard-view-mode");
      if (saved === "overview" || saved === "project") return saved;
    }
    return "overview";
  });

  const [taskView, setTaskView] = useState<TaskView>(() => {
    // Same-tab restore (reload / OS tab discard) keeps the view the operator was actually on.
    const sessionView = getScopedSessionTaskView();
    if (isTaskView(sessionView)) return resolveSessionTaskView(sessionView);

    const saved = getScopedItem("kb-dashboard-task-view");
    const legacyReliabilityView = migrateLegacyReliabilityView(saved);
    if (legacyReliabilityView) return legacyReliabilityView;
    const retiredStashRecoveryView = migrateRetiredStashRecoveryView(saved);
    if (retiredStashRecoveryView) return retiredStashRecoveryView;
    if (saved === "roadmaps") return migrateLegacyRoadmapsView(saved);
    if (isTaskView(saved)) return resolveLandingTaskView(normalizeTaskView(saved));
    return "board";
  });
  const hasHydratedScopedTaskViewRef = useRef(false);

  useEffect(() => {
    window.localStorage.setItem("kb-dashboard-view-mode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    /*
    First hydration of a tab that was already running (reload / discard-restore): the per-tab
    session copy is the operator's real last view, so honor it verbatim. Every later run of this
    effect is an explicit project switch and keeps the FN-7649 landing bounce.
    */
    if (!hasHydratedScopedTaskViewRef.current) {
      const sessionView = getScopedSessionTaskView(currentProject?.id);
      if (isTaskView(sessionView)) {
        setTaskView(resolveSessionTaskView(sessionView));
        if (currentProject?.id) {
          hasHydratedScopedTaskViewRef.current = true;
        }
        return;
      }
    }

    const saved = getScopedItem("kb-dashboard-task-view", currentProject?.id);
    const legacyReliabilityView = migrateLegacyReliabilityView(saved);
    const retiredStashRecoveryView = migrateRetiredStashRecoveryView(saved);
    if (legacyReliabilityView) {
      setTaskView(legacyReliabilityView);
    } else if (retiredStashRecoveryView) {
      setTaskView(retiredStashRecoveryView);
    } else if (saved === "roadmaps") {
      setTaskView(migrateLegacyRoadmapsView(saved));
    } else if (isTaskView(saved)) {
      const preserveLegacyOnFirstScopedHydration =
        !hasHydratedScopedTaskViewRef.current && saved === "devserver";

      setTaskView(
        preserveLegacyOnFirstScopedHydration ? "devserver" : resolveLandingTaskView(normalizeTaskView(saved)),
      );
    } else {
      setTaskView("board");
    }

    if (currentProject?.id) {
      hasHydratedScopedTaskViewRef.current = true;
    }
  }, [currentProject?.id]);

  useEffect(() => {
    setScopedItem("kb-dashboard-task-view", taskView, currentProject?.id);
    /*
    Per-tab copy: what THIS tab is showing right now, for a reload/discard-restore of this tab.
    Written with the same project scoping as the localStorage copy and never mirrored unscoped —
    an unscoped mirror would let the previous project's view leak into the next project's landing.
    */
    setScopedSessionTaskView(taskView, currentProject?.id);
  }, [currentProject?.id, taskView]);

  useEffect(() => {
    // FNXC:ReportPipeline 2026-07-18-12:30: Report traces describe only the
    // selected view name; never capture URLs, embedded identifiers, or content.
    if (isBuiltInTaskView(taskView)) recordActivity(taskView);
  }, [taskView]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const viewParam = new URLSearchParams(window.location.search).get("view");
    const legacyReliabilityView = migrateLegacyReliabilityView(viewParam);
    const retiredStashRecoveryView = migrateRetiredStashRecoveryView(viewParam);
    if (legacyReliabilityView) {
      setTaskView(legacyReliabilityView);
    } else if (retiredStashRecoveryView) {
      setTaskView(retiredStashRecoveryView);
    } else if (viewParam && isTaskView(viewParam)) {
      setTaskView(normalizeTaskView(viewParam));
    }
  }, []);

  useEffect(() => {
    if (projectsLoading || currentProjectLoading) return;

    if (currentProject && viewMode === "overview") {
      setViewMode("project");
    }
  }, [projectsLoading, currentProjectLoading, currentProject, viewMode]);

  /*
  FNXC:Onboarding 2026-06-22-05:06:
  Brand-new users should enter the unified onboarding sequence first: AI setup, GitHub, Project, Agent, then First Task.
  Do not auto-open the project-only setup wizard just because there are zero projects; that wizard is opened from the Project step or explicit Add Project actions.
  */

  const handleChangeTaskView = useCallback((newView: TaskView) => {
    setTaskView(newView);
  }, []);

  const handleToggleTheme = useCallback(() => {
    const cycle: ThemeMode[] = ["dark", "light", "system"];
    const currentIndex = cycle.indexOf(themeMode);
    const nextMode = cycle[(currentIndex + 1) % cycle.length];
    setThemeMode(nextMode);
  }, [themeMode, setThemeMode]);

  return {
    viewMode,
    setViewMode,
    taskView,
    setTaskView,
    handleChangeTaskView,
    handleToggleTheme,
  };
}
