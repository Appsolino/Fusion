# Steward S3 — Sensitive assistance

**Status:** IMPLEMENTED (gate OFF) — Appsolino + Host D only; unit-proven  
**Parent:** [`STEWARD-POLICY.md`](STEWARD-POLICY.md) · Programme [#78](https://github.com/Appsolino/Fusion/issues/78)

## May

Investigate · repair in branch · Level B/C validation · PR · dual Cursor APPROVE ·
writer live recompute + exact-head merge to Appsolino main (when `s3Enabled`) ·
AUTO-3 Host D deploy.

Entry: `infra/scripts/steward/s3/run-s3.mjs` (`runS3`). Writer merge is wired through
`writerRevalidateAndMaybeMerge` with `risk: SENSITIVE` and the live `s3Enabled` gate
(same exact-head path as S2). Default dry-run.

## Must not

Host P (structurally prohibited) · production activation · destructive production data ·
create/expand secrets · weaken rollback/audit/review · broaden GitHub App installation.

Owner-only boundaries → durable `NEEDS_OWNER`.

## Rollback path

`infra/scripts/steward/s3/rollback.mjs` (`describeS3RollbackPath`):

1. Scope: Appsolino/Fusion only — never Host P.
2. Capture previous main SHA before merge; revert the merge (or open exact-head revert PR).
3. If Host D was deployed via AUTO-3, roll back to the previous Host D release id from evidence.
4. If no Host D deploy was claimed, skip AUTO-3 rollback (do not invent Host D actions).
5. Re-run Level B/C validation on Appsolino (+ Host D if rolled back) before closing the incident.

A non-empty rollback plan is **required** for S3 eligibility. Plans must not instruct Host P access.

## Activation

`activation-policy.json` → `gates.s3Enabled` (default **false**) + emergency `KILL`.  
Provider/model pinned to Cursor — no silent xAI/alternate switch.
