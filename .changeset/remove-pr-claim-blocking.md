---
"@runfusion/fusion": patch
---

summary: Tasks no longer park blocked on open GitHub PRs touching their files; blockers are board tasks only.
category: fix
dev: Removes the FN-8700 PR/file-claim blocking mechanism — the AGENTS.md claim-check rule, `scripts/check-file-claimed.mjs`, `pr:N` blockedBy refs, file-claim classification in `execution-block-classifier.ts`, the session-log BLOCKED promotion, and the `reconcile-external-pr-blockers` self-healing sweep. Legacy file-claim parks are no longer honored by `isDurableBlockedTask`, so previously PR-blocked rows recover via normal paths.
