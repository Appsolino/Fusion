---
"@runfusion/fusion": patch
---

summary: Fix tasks stalling forever in progress with no session after the workflow role-agent rollout.
category: fix
dev: Two deadlocks in FN-8764's role routing, both silent. (1) The in-process runtime never passed its AgentStore into `TaskExecutorOptions`, so routing failed closed at every role-classified node. (2) A resumed run keeps its continuation work item active until the interpreter returns, so the next node's principal-fence upsert hit `idx_workflow_work_items_one_active_task_continuation` (not its ON CONFLICT target) and raised; the run then re-suspended every dispatch until an operator bounced the card. The executor now supersedes an active work item for a node the run has already left and retries once. Adds the `task:workflow-run-suspended` and `task:workflow-continuation-superseded` run-audit events, and logs principal holds and fence-write errors instead of swallowing them.
