> **Status: Historical/reference**
> This document does not override `MASTER-PLAN.md`, `OPERATING-MODEL.md` or `CURRENT-STATE.md`.

# Reliability Acceptance and Chaos Tests

Last updated: 2026-07-29
These tests are **mandatory before production use** of a clean-baseline release.
Pass = observed outcome matches Expected; artefacts retained.

## Environment

Tests **must** exercise the real path `fusion.service → Fusion engine → agent child process`, not only an interactive SSH login as `fusion`. SSH-shell success is insufficient evidence.

| ID | Test | Expected |
| --- | --- | --- |
| ACC-ENV-01 | Required paths writable under production unit policy | Dep install + worktree write succeed |
| ACC-ENV-02 | Release paths immutable | Writes to `/opt/.../releases/<id>` fail after activate |
| ACC-ENV-03 | Fusion service launches an agent command that runs `sudo -n id -u` | Output `0`; no prompt |
| ACC-ENV-04 | Fusion-launched agent performs an approved staging OS-package operation | Success |
| ACC-ENV-05 | Fusion-launched agent writes an approved test file under `/etc/appsolino-fusion` | Success |
| ACC-ENV-06 | Fusion-launched agent runs an approved systemd operation | Success |
| ACC-ENV-07 | Ordinary task remains inside bubblewrap and cannot unintentionally modify host paths | Write rejected |
| ACC-ENV-08 | Explicit host-admin mode exits bubblewrap and executes with sudo | Success and audit record |
| ACC-ENV-09 | No unexpected root ownership in mutable paths | Detector clean |

## Build

| ID | Test | Expected |
| --- | --- | --- |
| ACC-BLD-01 | Clean clone pinned SHA | Success |
| ACC-BLD-02 | Frozen lockfile install | Success |
| ACC-BLD-03 | Full package build | Success |
| ACC-BLD-04 | Packaged CLI boots | No backendHandle error |
| ACC-BLD-05 | Dashboard bundle serves health | 200 |
| ACC-BLD-06 | Plugins load per manifest | Success |
| ACC-BLD-07 | Migration set hash stable | Matches manifest |

## Release

| ID | Test | Expected |
| --- | --- | --- |
| ACC-REL-01 | DB schema newer than binary | Readiness fail closed |
| ACC-REL-02 | Migration required | Writes refused until migrate |
| ACC-REL-03 | Identity mismatch (CLI≠service) | Fail closed |
| ACC-REL-04 | Missing/invalid manifest | Fail closed |
| ACC-REL-05 | Activation interruption mid-switch | Previous or consistent current; never split-brain |
| ACC-REL-06 | Rollback to incompatible schemaMax | Blocked |

## Execution

| ID | Test | Expected |
| --- | --- | --- |
| ACC-EXE-01 | Kill worker process mid-stage | Lease expiry; checkpoint preserved; no duplicate side effects |
| ACC-EXE-02 | Restart fusion.service | In-flight recovers or terminals cleanly |
| ACC-EXE-03 | Reboot host | Same |
| ACC-EXE-04 | Lease expiry | No double dispatch with same fencing token |
| ACC-EXE-05 | Duplicate dispatch attempt | Second claim rejected |
| ACC-EXE-06 | Stale owner write | Rejected |

## Git

| ID | Test | Expected |
| --- | --- | --- |
| ACC-GIT-01 | Foreign commits on branch | `BLOCKED_BRANCH_CONTAMINATION` pre-token |
| ACC-GIT-02 | Stale base with merged dependency | Refresh or `BLOCKED_STALE_BASE` |
| ACC-GIT-03 | Wrong worktree bind | Fail closed |
| ACC-GIT-04 | Missing worktree | Reconstruct or terminal block |
| ACC-GIT-05 | Equal-count disjoint path sets | `BLOCKED_ATTRIBUTION_MISMATCH` |
| ACC-GIT-06 | Patch conflict | Deterministic block with diagnostics |
| ACC-GIT-07 | Integration branch advance | Policy-honouring rebuild/block |

## Verification

| ID | Test | Expected |
| --- | --- | --- |
| ACC-VER-01 | Zero tests when required | Fail closed |
| ACC-VER-02 | Command timeout | Process group dead; manifest failed |
| ACC-VER-03 | Differing cwd vs manifest | Fail |
| ACC-VER-04 | Missing dependency | Preflight fail pre-token |
| ACC-VER-05 | Cancelled process | Terminal cancelled |
| ACC-VER-06 | Exact replay across stages | Identical command/env/result hash path |

## Recovery

| ID | Test | Expected |
| --- | --- | --- |
| ACC-REC-01 | Deterministic block | No auto redispatch |
| ACC-REC-02 | Recovery generation bump | Exactly one redispatch allowed |
| ACC-REC-03 | Retry budget exhausted | Terminal disposition |
| ACC-REC-04 | Completed steps preserved | Not re-run after recovery |
| ACC-REC-05 | Automatic branch reconstruction | Clean `fusion/<task>/<exec>`; evidence archived |

## Provider

| ID | Test | Expected |
| --- | --- | --- |
| ACC-PRV-01 | Rate limit | Backoff; classified |
| ACC-PRV-02 | Provider outage | Failover or infra block; not code failure |
| ACC-PRV-03 | Quota exhausted | Terminal provider budget |
| ACC-PRV-04 | Invalid credentials | Preflight/provider auth fail |
| ACC-PRV-05 | Fallback provider | Success path documented |
| ACC-PRV-06 | Context-limit failure | Typed; no infinite retry same prompt |

## Operations

| ID | Test | Expected |
| --- | --- | --- |
| ACC-OPS-01 | Database unavailable | Fail closed; alert |
| ACC-OPS-02 | Disk full | Infra block; no merges |
| ACC-OPS-03 | Backup failure | Alert P0 |
| ACC-OPS-04 | Restore from backup | Scratch Fusion readiness green |
| ACC-OPS-05 | Host rebuild | RTO met |
| ACC-OPS-06 | GitHub unavailable | Cached artefact activate still works |
| ACC-OPS-07 | Source push failure | Alert; no silent drift |

## Thresholds

- P0 classes: **100% pass** before any production promote
- P1 classes: **100% pass** before multi-agent scale (Phase 8)
- Chaos (kill -9, reboot, disk fill): at least once per release candidate on staging
