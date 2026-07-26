---
"@runfusion/fusion": patch
---

summary: Deny now hides fn_task_create from agents, and retried task creates no longer duplicate.
category: fix
dev: Adds `isAgentTaskCreateToolAvailable(settings, callerIsEphemeral)` in `@fusion/engine` agent-tools; the outer execution session (`executor.ts`) and per-step workflow sessions (`step-session-executor.ts`) omit `fn_task_create` from the tool list when the project policy resolves to `deny`. `isEphemeralCallerAgent` in the pi extension now fails closed: a caller id that is present but unresolvable counts as ephemeral, so the policy still applies. `upon_validation` keeps the tool (it proposes to the mailbox); permanent-agent and human/chat callers are unaffected. Separately, the deterministic content-fingerprint duplicate window in `duplicate-guard.ts` goes 60s -> 10m (clamp ceiling 5m -> 1h) so an agent that retries a create after a tool timeout links the existing task instead of filing a second one.
