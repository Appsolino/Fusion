# Cursor Approval Agent — scope for machine-managed branches

<!-- FNXC:AutomationGovernance 2026-08-07-20:15 -->

External Cursor Automation **Pull Request Router and Approver**
(`83ebd12a-8fb8-11f1-a7d1-d6b4613131ce`, actor `cursor[bot]`):

```text
Status: DISABLED by owner (2026-08-07)
Verification: pending on next automation/upstream-* PR
  — confirm no cursor[bot] review
  — confirm no Anas966 re-request from cursor[bot]
Then close ISS-UP-GOV-001.
```

Repo-side defensive cleanup of accidental owner-reviewer requests on
`automation/upstream-*` remains until live verification succeeds.

## Intended boundary (when re-enabled)

```text
IGNORE branches:
  automation/upstream-*
  auto2-proof/*
```

Normal developer PRs may use the agent; machine-managed upstream candidates must not.

See `docs/appsolino/upstream/AUTOMATION-MAP.json`.
