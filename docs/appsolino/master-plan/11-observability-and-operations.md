# Observability and Operations

Last updated: 2026-07-29

## 1. Single operational view (required fields)

- server health; database health
- current release ID; current schema / schemaMax
- queue depth; active tasks; active agents; active stage leases
- task stage; last checkpoint; retry count; recovery generation
- deterministic blocks (code + fingerprint)
- model provider; token/cost consumption
- worktree count; disk usage
- backup status; latest restore test result
- failed release activation
- GitHub push lag
- root-owned contamination flag
- production-build-attempt flag (must be zero on Host P)

## 2. Signals

| Signal | Backend | Notes |
| --- | --- | --- |
| Metrics | OpenTelemetry → Prometheus | RED for API; gauges for queues/leases/disk |
| Logs | Structured JSON → Loki | Correlate `taskId`, `executionId`, `generation` |
| Traces | OTel traces | Stage spans + provider calls |
| Errors | Sentry | Fingerprint deterministic codes separately from crashes |

## 3. High-value alerts

| Alert | Severity |
| --- | --- |
| Schema mismatch / binary older than DB | P0 |
| Release identity mismatch (symlink ≠ manifest ≠ CLI) | P0 |
| Repeated failure fingerprint (>N / window) | P0 |
| Task stuck beyond stage SLA | P1 |
| Lease expired while process alive | P0 |
| Duplicate owner / double claim | P0 |
| Disk usage threshold | P1 |
| Database backup failure | P0 |
| Restore test failure | P0 |
| Source not pushed / push lag | P2 |
| Provider outage | P1 |
| Token-cost anomaly | P1 |
| Worktree leak | P2 |
| Root-owned files in runtime paths | P1 |
| Production build on production host | P0 |
| Systemd unit / firewall / current symlink unexpected change | P1 |

## 4. Operating procedures (short)

| Event | Procedure |
| --- | --- |
| Deterministic block storm | Inspect fingerprint; freeze auto-retry; run branch reconstruction playbook |
| Schema mismatch | Stop claims; do not “fix” with older binary; promote coherent release or restore DB |
| Provider outage | Enable failover; pause non-critical missions |
| Disk full | Block new worktrees; GC archives; never continue merges |
| Failed activation | Automatic leave previous release; page on-call; no manual symlink edits |
| Host compromise suspicion | Revoke GitHub/cloud tokens; rotate secrets; rebuild host from clean image; restore PG from off-host |

## 5. Relation to current tooling

Keep conceptual successors of:

- `fusion-production-health` (passive checks + bounded restart)
- backup verify / DR drill timers

Replace journal-first debugging (ISS-OPS-001) with the execution view above.
