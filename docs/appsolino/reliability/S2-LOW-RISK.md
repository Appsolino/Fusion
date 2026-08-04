# Steward S2 — Low-risk autonomy

**Status:** IMPLEMENTED (gate OFF) — awaiting Phase 3 proofs + `XAI_API_KEY`  
**Parent:** [`STEWARD-POLICY.md`](STEWARD-POLICY.md)

## Flow

```text
repair PR → CI green → Grok reviewer APPROVE → Grok approver APPROVE
  → exact-head merge (--match-head-commit) → optional workflow resume
  → terminal verify → close/update incident → programme ledger
```

## Playbooks (regenerate from merged tree)

- generated-baselines
- generated-snapshots
- lockfile-regen-unchanged-intent
- formatting-lint-only
- known-safe-workflow-metadata
- stale-status-document-fields

Never resolve generated artifacts by choosing ours/theirs.

## Activation

`activation-policy.json` → `gates.s2Enabled` (default false) + emergency `KILL`.
