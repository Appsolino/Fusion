# Steward S2 — Low-risk autonomy

**Status:** IMPLEMENTED (gate OFF) — unit-proven; live activation deferred  
**Parent:** [`STEWARD-POLICY.md`](STEWARD-POLICY.md) · Programme [#78](https://github.com/Appsolino/Fusion/issues/78)

## Flow

```text
repair PR → required CI (Lint/Typecheck/Build/Gate/Desktop packaging)
  → Cursor reviewer APPROVE → Cursor approver APPROVE
  → writer live digest recomputation (never artifact self-compare)
  → exact-head merge (--match-head-commit)
  → originating incident reconciliation (comment + label hygiene)
```

Entry: `infra/scripts/steward/s2/run-s2.mjs` (`runS2`). Default dry-run.

## Playbooks (regenerate from merged tree)

Allowlist only:

- generated-baselines
- generated-snapshots
- lockfile-regen-unchanged-intent (requires `dependencyIntentUnchanged`)
- formatting-lint-only (requires `formatOnly` attestation)
- known-safe-workflow-metadata (requires `workflowMetadataOnly` attestation)
- stale-status-document-fields

Never resolve generated artifacts by choosing ours/theirs.

**Must not classify as LOW:** semantic-source · workflow (without metadata attestation) ·
migration · permission · deployment · dependency-intent (changed lockfile intent).

## Activation

`activation-policy.json` → `gates.s2Enabled` (default **false**) + emergency `KILL`.  
Do not enable until Phase proofs complete. Provider/model pinned to Cursor (`cursor-cli` /
`composer-2.5`) — no silent provider switch.
