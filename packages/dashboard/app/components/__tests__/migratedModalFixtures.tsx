/*
FNXC:ModalTouchGeometry 2026-07-26-16:28:
FN-8607 keeps migration coverage data-driven so each long-lived dialog must declare its shared
geometry identity and dismissal decision rather than relying on FloatingWindow defaults.
*/
export const migratedModalFixtures = [
  // FNXC:ModalTouchGeometry 2026-07-26-18:49: The inventory's brief-action opt-outs stay visible here so the ratchet cannot silently lose a required surface.
  { name: "AgentErrorDetailsModal", file: "AgentErrorDetailsModal.tsx", key: null, outside: true, optOut: "brief error acknowledgement" },
  { name: "ModelSelectionModal", file: "ModelSelectionModal.tsx", key: null, outside: true, optOut: "compact focused choice" },
  { name: "ReportModal", file: "ReportModal.tsx", key: null, outside: false, optOut: "brief reporting action" },
  { name: "ResearchTaskActionModal", file: "ResearchTaskActionModal.tsx", key: null, outside: true, optOut: "bounded task-action confirmation" },
  { name: "SettingsSyncConflictModal", file: "SettingsSyncConflictModal.tsx", key: null, outside: true, optOut: "urgent blocking conflict decision" },
  { name: "StashConflictModal", file: "StashConflictModal.tsx", key: null, outside: false, optOut: "urgent bounded git-conflict recovery" },
  { name: "AgentListModal", file: "AgentListModal.tsx", key: "floating-window:agent-list", outside: true },
  { name: "AgentImportModal", file: "AgentImportModal.tsx", key: "floating-window:agent-import", outside: true },
  { name: "AgentGenerationModal", file: "AgentGenerationModal.tsx", key: "floating-window:agent-generation", outside: true },
  { name: "AgentOnboardingModal", file: "AgentOnboardingModal.tsx", key: "floating-window:agent-onboarding", outside: false },
  { name: "ExperimentalAgentOnboardingModal", file: "ExperimentalAgentOnboardingModal.tsx", key: "floating-window:experimental-agent-onboarding", outside: false },
  { name: "SetupWizardModal", file: "SetupWizardModal.tsx", key: "floating-window:setup-wizard", outside: false },
  { name: "NativeShellOnboardingModal", file: "NativeShellOnboardingModal.tsx", key: "floating-window:native-shell-onboarding", outside: false },
  { name: "DockerNodeOnboardingModal", file: "DockerNodeOnboardingModal.tsx", key: "floating-window:docker-node-onboarding", outside: true },
  { name: "MailboxModal", file: "MailboxModal.tsx", key: "floating-window:mailbox", outside: true },
  { name: "MilestoneSliceInterviewModal", file: "MilestoneSliceInterviewModal.tsx", key: "floating-window:milestone-slice-interview", outside: true },
  { name: "SubtaskBreakdownModal", file: "SubtaskBreakdownModal.tsx", key: "floating-window:subtask-breakdown", outside: true },
] as const;
