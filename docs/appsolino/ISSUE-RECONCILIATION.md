# Appsolino ↔ Upstream Issue Reconciliation

Authoritative mapping of Appsolino-local concerns (FUS-*) to upstream
Runfusion/Fusion issues and PRs. Maintained by
`fusion-update` reconciliation (`state/upstream-reconciliation.json`).

Classifications:

| Class | Meaning |
|-------|---------|
| `FIXED_UPSTREAM` | Upstream shipped a fix; Appsolino can drop or thin the local patch after validation |
| `PARTIALLY_FIXED_UPSTREAM` | Upstream addressed part of the concern; local guard still required |
| `OPEN_UPSTREAM_ISSUE` | Matching upstream issue still open |
| `OPEN_UPSTREAM_PR` | Matching upstream PR in flight |
| `NO_UPSTREAM_MATCH` | No corresponding upstream issue/PR found |
| `APPSOLINO_SPECIFIC` | Intentional Appsolino behavior; do not expect upstream parity |

## Current mappings

| Local ID | Summary | Classification | Upstream | Notes |
|----------|---------|----------------|----------|-------|
| FUS-010 | Explicit `task.autoMerge=false` hard deny | `APPSOLINO_SPECIFIC` | — | Must survive every upstream merge |
| FUS-029 | Retry returns `AUTO_MERGE_DISABLED` without enqueue | `APPSOLINO_SPECIFIC` | — | Paired with FUS-010 |
| APP-002 | Production fixture task with `autoMerge=false` | `APPSOLINO_SPECIFIC` | — | Never use as a test harness task |
| appsolino_0001 | PostgreSQL runtime marker grants migration | `APPSOLINO_SPECIFIC` | — | Must remain registered in schema-applier |
| CI filter | `appsolino/stable` PR checks path filter | `APPSOLINO_SPECIFIC` | — | `.github/workflows/pr-checks.yml` |

## Update policy

- Incremental reconcile on each controller tick (last inspected upstream SHA only).
- Full reconcile weekly, or when a candidate touches Appsolino-protected paths.
- Full reconcile must not delay unrelated routine updates.
