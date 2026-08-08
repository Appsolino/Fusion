---
"@runfusion/fusion": patch
---

summary: Fix Cursor planning settlement and PostgreSQL lifecycle-lock readiness for Host D soaks.
category: fix
dev: Cursor runtime exposes settleFallbackDispatch; non-pooler DATABASE_URL is a direct session endpoint for planning lifecycle locks; unsettled planning releases pre-execution worktrees.
