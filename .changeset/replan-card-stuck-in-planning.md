---
"@runfusion/fusion": patch
---

summary: Cards sent back for re-planning by Plan Review now actually get re-planned instead of sitting in Planning.
category: fix
dev: `hasAdvancedPastPlanning` now lets an explicit planning-stage status (`needs-replan`, `plan-review-unavailable`, `planning`) outrank the sticky `firstExecutionAt`/`executionStartedAt` evidence added in the plan-worktree cutover, so triage discovery re-admits a rebounded card. A triage card carrying an execution timestamp with no planning status is still excluded for self-healing's advanced recovery (PR #2360).
