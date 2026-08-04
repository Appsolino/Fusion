# Steward S3 — Sensitive assistance

**Status:** IMPLEMENTED (gate OFF) — Appsolino + Host D only  
**Parent:** [`STEWARD-POLICY.md`](STEWARD-POLICY.md)

## May

Investigate · repair in branch · Level B/C validation · PR · dual Cursor APPROVE ·
exact-head merge to Appsolino main · AUTO-3 Host D deploy.

## Must not

Host P · production activation · destructive production data · create/expand secrets ·
weaken rollback/audit/review · broaden GitHub App installation.

Owner-only boundaries → durable `NEEDS_OWNER`.

## Activation

`activation-policy.json` → `gates.s3Enabled` (default false) + emergency `KILL`.
