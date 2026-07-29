# Risk Register

Last updated: 2026-07-29

| ID | Risk | Likelihood | Impact | Mitigation | Residual | Owner/component |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | Schema/binary split bricks CLI while UI looks healthy | High (present) | High | Coherent ≥schemaMax release; readiness on service start; ACC-REL-01 | Medium until cutover | release-schema-consistency, activator |
| R-02 | Surgical overlay becomes permanent | High | High | Phase 3–4 retirement gate | Medium | release eng |
| R-03 | Contaminated-branch cherry-pick reintroduces foreign history | Medium | High | File-level re-land only; contamination gate | Low | Git safety |
| R-04 | Upstream worktree changes conflict with Appsolino patches | High | Medium | Thin hooks + new modules; frequent absorb | Medium | fork strategy |
| R-05 | Lifecycle multi-authority remains after Phase 5 | Medium | High | One coordinator; narrow healers; leases | Medium | engine |
| R-06 | Temporal/Restate premature adoption stalls product | Low | High | Defer; reconsider only after Phase 5 fail | Low | strategy |
| R-07 | Full sudo deletes local state / misconfigures firewall | Medium | Medium | Immutable releases; alerts; off-host undeletable backups | Medium | ops |
| R-08 | Backup credentials can delete vault | Low | Critical | Append-only separate account | Low | DR |
| R-09 | Single provider outage stops all agents | Medium | High | Gateway failover Phase 7 | Medium | providers |
| R-10 | Deterministic retry loops burn tokens | High without Phase 5 | High | Fingerprints + budgets | Low after Phase 5 | disposition |
| R-11 | Host undersized for Tier 2 | High on current box | Medium | Topology split; sizing tiers | Medium | infra |
| R-12 | Migration numbering clash on absorb | Medium | High | Migration policy; never renumber upstream | Medium | schema |
| R-13 | `mergeActive` leaks block merges | Medium | Medium | Durable leases | Low after Phase 5 | project-engine |
| R-14 | Stale planning bases (#2476) | High upstream | High | Base refresh control | Medium until fixed | worktree-acquisition |
| R-15 | Lost dirty `fusion-development` work before preserve | Medium | High | Preservation before reset (reset docs) | Medium until snapshot | operator |
| R-16 | Release-controller false state resumes bad deploy | Medium | High | Freeze controller until activator rewrite (`OD-CONTROLLER`) | Medium | fusion-update |
| R-17 | Packaged tests still mocked critical paths | Medium | Medium | ACC packaged suite; mock budget | Medium | QA |
| R-18 | Observability without actionability | Medium | Medium | Alert list mandatory; runbooks | Medium | ops |
| R-19 | Agent activates bad prod release without confirm | Medium | High | `OD-ACTIVATE-AUTH` policy | Medium | activator |
| R-20 | Upstream pin moves under Appsolino mid-phase | Medium | Medium | Pin commits; absorb via integration branches only | Low | fork |
| R-21 | Staging unit crash-loop / wrong WorkingDirectory (`CHDIR`) | High (observed on current host) | Medium | Fix staging paths in Phase 2; ACC staging boot | Low after Phase 2 | fusion-staging.service |
| R-22 | DR restore drill failing while timer still armed | High (observed) | High | Treat drill failure as P0; fix identity/permissions before trusting backups | Medium | fusion-dr-restore-drill |
| R-23 | Backup/DR jobs still running as `anas` while service is `fusion` | Medium (observed) | Medium | Normalize automation user to `fusion` / dedicated backup user in provisioning | Low after Phase 2 | fusion-update timers |
| R-24 | Memory pressure on single host (`MemoryPeak` ~4.8 GiB + swap) | High on current box | Medium | Topology split; Tier RAM guidance; NODE_OPTIONS caps | Medium | infra |
| R-25 | `appsolino/stable` far behind upstream (~90+ commits locally compared) | High | Medium | Absorb cadence via integration branches; do not jump stable straight to prod | Medium | fork |
| R-26 | Verification command reconstruction differs executor vs merger | High | High | Phase 6 verification manifests with exact replay | Low after Phase 6 | executor / merger-ai |

## Residual risk statement

Even after full programme completion, provider outages, novel model failures, and novel Git edge cases can still fail tasks. The residual risk accepted by the reliability contract is **bounded, typed, non-looping failure** — not zero failure.
