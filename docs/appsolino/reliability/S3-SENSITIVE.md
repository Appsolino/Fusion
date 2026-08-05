# Steward S3 — Sensitive assist

**Status:** ENABLING (programme #78)

S3 allows SENSITIVE exact-head merge after dual Cursor APPROVE + writer recomputation on Appsolino/Fusion only.

## Controls
- `gates.s3Enabled` in activation-policy.json
- Dual Cursor reviewer + approver (composer-2.5)
- Writer live recomputation of head/diff/checks
- Exact-head merge only

## Rollback
1. Revert the exact-head merge commit on Appsolino `main`.
2. Host D: AUTO-3 rollback to the previous release id.
3. Preserve `enginePaused=true` where required.

## Prohibited
Host P access · production deploy · silent provider/model switch · merging without dual APPROVE
