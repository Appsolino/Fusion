# AUTO-4 owner approval packet — pinned upstream `71576d953626`

**Status:** SENSITIVE / WAITING — do **not** ask the owner to approve PR #47 until the AUTO-2 sensitive-approval correction is on main and App installation token mint succeeds.

## Pin / identity

| Item | Value |
| --- | --- |
| Pinned upstream SHA | `71576d9536267a7835f352922a55831811717896` |
| Appsolino main (base) | `04a7b4cf519f29afbb0612414a0badbb18143f31` |
| Integration PR | https://github.com/Appsolino/Fusion/pull/47 |
| Candidate head SHA | `f42eaa96ff1e060d0d00416f62d21843902f8b51` |
| Superseded | PR #34 closed |

## Blocker before owner approval of #47

1. Land correction PR: trusted `upstream-auto2-approve-sensitive.yml` + finalizer exact-head review verification.
2. Restore GitHub App installation permissions (`contents` / `pull-requests` / `workflows` / `actions` write). Phase 1 finalize dispatch on #47 still fails at token mint ([run 30684669269](https://github.com/Appsolino/Fusion/actions/runs/30684669269)).
3. Re-dispatch finalize on #47 **without** approval → expect `approval-required`, no merge.
4. Owner submits GitHub APPROVED review on exact head `f42eaa96ff1e…` as `Anas966`.
5. Dispatch **Upstream AUTO-2 Approve Sensitive** with `pr_number=47` and that exact `approved_head`.

## Prior AUTO-2 gap (accurate)

AUTO-2 classified sensitive PRs correctly but had no implemented trusted post-approval merge path. Even `ownerApproved=true` returned `approval-required` and never merged.

## Host D (unchanged during correction)

Active: `auto3-0.74.0-beta.5-a1b78a197860` · Rollback: `g13b-0.74.0-beta.5-cadf34dd4` · `enginePaused=true`
