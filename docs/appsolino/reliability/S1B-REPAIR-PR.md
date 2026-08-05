# Steward S1B — Repair PR Agent

**Status:** IMPLEMENTING (programme [#78](https://github.com/Appsolino/Fusion/issues/78)) — **gate OFF**  
**Ledger:** [`../CURRENT-STATE.md`](../CURRENT-STATE.md)

S1B creates **one** bounded repair PR from an accepted S1A assessment. It does not merge, deploy, or access Host P.

Live orchestration is implemented under `infra/scripts/steward/s1b/` (worktree → Cursor `composer-2.5` repair → tests → Automation App push/PR → dual Cursor review with `merge=false`). **Activation and live proof remain separate** — do not treat this document as proof-complete.

## Activation

```text
infra/scripts/steward/activation/activation-policy.json → gates.s1bEnabled
optional env: STEWARD_S1B_ENABLED=true
killSwitch / activation/KILL overrides all enables
```

## Trigger

- Open steward incident
- Terminal S1A assessment with `repairRecommended=true`
- Reviewer `ACCEPT`
- No existing repair for fingerprint+occurrence
- Not CRITICAL
- Gate enabled

## Bounds

- Provider/model: `cursor-cli` / `composer-2.5` (fail closed on drift)
- Worktree: `/srv/appsolino-fusion/phase-1/worktrees/repair-<issue>-<occurrence>`
- Branch: `repair/steward-<issue>-<fingerprint12>`
- One PR per occurrence
- Cursor dual reviewer + approver (separate sessions) required before exact-head merge
- Automation App push identity only (`S1B_GITHUB_APP_TOKEN`)

## Forbidden

Main direct write · Host P · self-approval · secret expansion · silent provider switch · duplicate repair PRs · merge/deploy inside S1B
