---
"@runfusion/fusion": patch
---

summary: Honor explicit task autoMerge=false for all automatic merge paths and Retry.
category: fix
dev: FUS-010/FUS-029 — `allowsAutoMergeProcessing` requires `resolveEffectiveAutoMerge === true`; merge-worker hard-guard + Retry parks as `awaiting-user-review` without re-arming merge.
