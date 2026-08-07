# Cursor Approval Agent — exclude automation branches

<!-- FNXC:AutomationGovernance 2026-08-07-19:57 -->

External Cursor Automation **Pull Request Router and Approver**
(`83ebd12a-8fb8-11f1-a7d1-d6b4613131ce`, actor `cursor[bot]`) must **not**
operate on Appsolino machine-managed upstream candidates.

## Required ignore scope

```text
IGNORE branches:
  automation/upstream-*
  auto2-proof/*
```

## Why

On #144 that agent repeatedly COMMENTED “not approving” and re-requested
`Anas966` on every `synchronize`, overlapping the intended controller:

```text
AUTO-1 → AUTO-2 Validate → Finalize → SENSITIVE_REVIEW → merge
```

`appsolino-fusion-automation[bot]` + AI verifier APPROVE is the gold path.
`cursor[bot]` comments are **not** that path.

## Operator action

1. Open Cursor Automations → edit `83ebd12a-8fb8-11f1-a7d1-d6b4613131ce`
   (or use Glass `open_automation` with that id).
2. Add branch ignore / path filter for `automation/upstream-*` and `auto2-proof/*`.
3. Leave ordinary human/dev PRs in scope if still useful.

Until configured, finalize continues clearing `Anas966` request residue on
`automation/upstream-*`.

See `docs/appsolino/upstream/AUTOMATION-MAP.json`.
