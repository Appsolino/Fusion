# Appsolino Fusion — master plan

**Governing.** Architecture and completion definition.
**Status:** see [`../CURRENT-STATE.md`](../CURRENT-STATE.md) only.
**Process:** [`../OPERATING-MODEL.md`](../OPERATING-MODEL.md).
**Reading time:** ≤ 3 minutes.

## Primary objective

Build a **reliable autonomous Fusion dashboard** that completes development work **without routine operator intervention**.

## Reliability contract

Every task must either:

1. complete successfully; or
2. stop **once** in a clear, durable, actionable terminal state.

It must **not**:

- lose completed work;
- execute the same attempt twice;
- contaminate another task or repository;
- silently change providers;
- report success without making the requested changes;
- repeat the same deterministic failure indefinitely;
- require routine SSH commands from the owner.

Failures stay visible. Humans are asked only for first-time credentials, irreversible/high-risk decisions, production approval, or failures automation cannot safely resolve.

## Topology

```text
Host D — development, build, staging, immutable staging releases, a.anas.bz
Host P — production only (no source builds); human-gated activation
```

Host D must never host production service, DB, role, credentials, or state paths.
Legacy degraded production stays frozen until replacement smoke passes.

```text
Host D automatic development deployment: YES (required)
Host P automatic production deployment: NO
Production activation: explicit owner approval
```

## Automation architecture

```text
Runfusion/Fusion:main
  → detect
  → automation/upstream-* (merge --no-ff; one active sync)
  → risk classify + Correction A/B + migration proof when needed
  → sync PR (safe auto-merge | sensitive → one owner approval)
  → Appsolino main
  → build once → immutable Host D release → staging activate
  → health / smoke; automatic rollback on failure
```

Read-only upstream monitoring is **detection only**, not the updater.
Durable automation identity: dedicated **Appsolino Automation GitHub App** (not the owner’s interactive OAuth; not ad-hoc PAT in job scripts for routine work). Minimum: Contents, PRs, Workflows, Actions (read), Issues, Metadata — install only on `Appsolino/Fusion`.

## Definition of finished (Personal Project v1)

Usable Fusion on **Host P**; backup + restore proven; rebuildable from Git; Host D runs automated absorb + automated staging releases. Not “every future reliability programme item.”

## Human approval boundaries

| Always automated (target) | Human required |
| --- | --- |
| Upstream detect/prepare, tests, package, Host D deploy/rollback, issue recording | First-time credentials; sensitive sync approval; destructive data ops; Host P / production |

## Authorised sequence

```text
G0 governance → G1 real provider (V1A.3) → AUTO-1 OPERATIONAL → AUTO-2 (NOW) → AUTO-3 → AUTO-4 catch-up → V1B (deferred)
Parked: ISS-UI-001 / PR #28 (not FIXED; do not merge while AUTO sequence is active)
```

Live phase and blockers: [`CURRENT-STATE.md`](../CURRENT-STATE.md).

## Document index

| Doc | Role |
| --- | --- |
| [`../START-HERE.md`](../START-HERE.md) | Entry |
| This file | Governing architecture |
| [`../OPERATING-MODEL.md`](../OPERATING-MODEL.md) | Governing process |
| [`../CURRENT-STATE.md`](../CURRENT-STATE.md) | Authoritative status |
| `00`–`15` (except this file) | Historical/reference |
| [`../upstream/UPSTREAM-MONITORING.md`](../upstream/UPSTREAM-MONITORING.md) | Upstream detect/absorb notes |
| GitHub Issues | Incident detail |
