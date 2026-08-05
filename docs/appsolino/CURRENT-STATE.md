# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-04T11:50:00Z

| Field | Value |
| --- | --- |
| S1A implementation baseline SHA | `be0aeee7710aba632a267d34737fd18cdeb0f2db` (PR #76) |
| Documentation closure merge SHA | `1a507b22ab2af14e3c46f6a5c2dad3d2890b28a0` (PR #77) |
| Programme tracking | Issue [#78](https://github.com/Appsolino/Fusion/issues/78) · ledger `infra/scripts/steward/programme/ledger.json` |
| Live `main` SHA | **Resolve dynamically** (`git fetch origin && git rev-parse origin/main`) — not stored here |
| Control plane | PR #80 **MERGED** (`672cb61898ab…`) — Cursor dual-review on main; gates OFF |
| Active upstream sync | [PR #82](https://github.com/Appsolino/Fusion/pull/82) (`993a2f9d866d`) — supersedes closed #81/#68/#57/#60 |
| Owner gate #79 | **CLOSED (not_planned / SUPERSEDED)** — Cursor-only dual review; no xAI key |
| Active Host D release | `auto3-0.74.0-beta.6-16f24ed3b473` |
| Source SHA | `16f24ed3b47321cc1b5aa693b2fac7e13a00b379` (PR #55 absorb) |
| Previous rollback release | `auto3-0.74.0-beta.5-5f1b923bd815` |
| Schema ceiling | **0039** |
| Staging health | `ok` / `0.74.0-beta.6` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Host P state | Deferred / untouched (**accessed=NO** — **prohibited**) |
| Legacy production | DEGRADED / FROZEN |
| Operating mode | **CONTINUOUS UPSTREAM MAINTENANCE** · trusted-main dual-review proof next (gh-compat + Cursor secret) |

## Owner priority

```text
NOW:     Land gh-compat/Cursor-secret fix → re-run trusted-main dual-review proof on #82 (merge=false)
NEXT:    Gate A/B → S1B/S2/S3 → merge #82 → AUTO-3
HOLD:    Host P / production — PROHIBITED
DONE:    S0 ACCEPTED; S1A MANUAL LIVE PROOF PASS (issue #74)
DONE:    Owner chose Cursor-only review; #79 closed not_planned
DONE:    PR #80 bootstrap owner merge (677465de… → main 672cb618…)
DONE:    One active upstream sync: PR #82 only
NOTE:    Activation gates remain OFF; first proof may end merge-blocked (s3-gate-disabled)
NOTE:    Engine stays paused. Host P untouched / prohibited.
```

## Steward enablement

| Item | Value |
| --- | --- |
| S0 status | **ACCEPTED** |
| S1A status | **IMPLEMENTED / MANUAL ACTIVE** — auto handoff gated OFF until programme Gate A/B |
| S1B status | **IMPLEMENTING** (programme #78) — not yet activated |
| S2 / S3 | **IMPLEMENTING** under programme — not yet activated |
| Automatic S1A handoff | **OFF** (`activation-policy.json` + optional env overrides) |
| Dual review | **CURSOR-ONLY** (implementer/reviewer/approver) — no xAI |
| Engine | **paused** |
| Host P | **prohibited** |

## AUTO-1 / AUTO-2 / AUTO-3 / Steward

| Lane | Status |
| --- | --- |
| AUTO-1 | OPERATIONAL |
| AUTO-2 | OPERATIONAL |
| AUTO-3 | OPERATIONAL |
| Steward S0 | **ACCEPTED** |
| Steward S1A | **MANUAL ACTIVE** (auto pending programme) |
| Steward S1B+ | **PROGRAMME IN PROGRESS** |

## Next authorised mission

1. Land PR #80 Cursor dual-review control plane.  
2. S1A Gate A then Gate B automatic activation proofs.  
3. S1B → S2 → S3; merge #82; AUTO-1/2/3 Host D E2E proof.  
4. Never access Host P from this programme.  
