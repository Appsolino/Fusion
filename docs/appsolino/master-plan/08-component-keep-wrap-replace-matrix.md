# Component Keep / Wrap / Replace Matrix

Last updated: 2026-07-29
Decisions are for the reliability programme — not popularity contests.

| Component | Candidate | Decision | Problem solved | Integration | Reliability gain | Ops burden | Migration cost | Conflict reduction | Failure mode | Lock-in | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Task orchestration | Native Fusion coordinator | **Harden** | Lifecycle races, retries | In-tree Phase 5 | High if leases/checkpoints land | Medium | Medium | Low vs upstream | Still complex | Low | Default |
| Task orchestration | Restate | **Reconsider later** | Durable handlers | Deep rewrite | Potentially high | High | Very high | N/A | Product model change | Medium | Stop condition if chosen early |
| Task orchestration | Temporal | **Reconsider later** | Durable workflows | Deep rewrite | Potentially high | High | Very high | N/A | Changes Fusion identity | High | Same |
| Model providers | Native plugins | **Keep + Harden** | Multi-runtime agents | Existing plugins | Baseline | Low | Low | — | Provider outage | Low | Keep |
| Model gateway | LiteLLM | **Wrap** (Phase 7) | Routing, failover, budgets | Sidecar/proxy | Medium–high | Medium | Medium | Reduces provider ifs | Gateway outage | Medium | After native taxonomy |
| Model gateway | OpenRouter-class | **Wrap** optional | Unified HTTP API | Provider adapter | Medium | Low–med | Low | — | Vendor outage | Medium | Alternative to LiteLLM |
| Metrics | Prometheus | **Keep/Adopt** | Alerting | OTel→Prom | High | Low | Low | — | Cardinality | Low | |
| Dashboards | Grafana | **Adopt** | Ops visibility | Prom/Loki | High | Low | Low | — | Misconfig | Low | |
| Logs | Loki (or equiv) | **Adopt** | Replace journal archaeology | OTel logs | High | Medium | Medium | — | Retention cost | Low | |
| Traces | OTel + Tempo/Jaeger | **Adopt** | Stage/lease spans | Engine hooks | Medium | Medium | Medium | — | Overhead | Low | |
| Errors | Sentry | **Adopt** | Crash fingerprints | SDK | Medium | Low | Low | — | PII risk | Medium | Scrub secrets |
| Database | Embedded PG | **Disable** for prod long-term | Convenience | Upstream feature | Low for DR | Low | — | — | Backup ambiguity | Low | OK for local only |
| Database | Self-hosted external PG | **Keep** option | Control | Network | High vs embedded | Medium | Medium | — | Host ops | Low | |
| Database | Managed PG | **Prefer** for Host P | Backups/HA | Network | High | Low | Medium | — | Vendor | Medium | `OD-PG` |
| Isolation | bubblewrap | **Harden** | Task FS/net limits | Upstream sandbox | High | Low | Low | Aligns upstream | userns disabled | Low | Primary |
| Isolation | Docker tasks | **Wrap** optional | Stronger isolation | Worker pool | Medium | Medium | Medium | — | Worktree pain | Medium | Tier 3 |
| Isolation | Rootless containers | **Reconsider later** | Non-root isolate | — | Medium | Medium | Medium | — | Kernel deps | Low | |
| Isolation | Ephemeral VMs | **Reconsider later** | Hard multi-tenant | — | High | High | High | — | Cost/latency | Medium | |
| CI/release | GitHub Actions | **Keep** | Reproducible build | Host B runner optional | High | Low | Low | — | GH outage | Medium | |
| CI/release | Self-hosted runner | **Wrap** | Private builds | Host B | Medium | Medium | Low | — | Runner compromise | Low | Recommended on Host B |
| Artefacts | Container registry / object store | **Adopt** | Immutable releases | Activator pull | High | Low | Low | — | Registry outage | Low | |
| Git/worktrees | Native Git | **Harden** | Provenance branches | Engine | High | Low | Low | — | Contamination | Low | |
| Git/worktrees | worktrunk / other managers | **Reject** now | UX sugar | — | Low | Medium | Medium | Risk | Extra abstraction | Medium | Avoid |
| Self-healing | Native self-healing | **Harden** (narrow) | Crash recovery | Engine | Medium | Medium | — | Conflicts #2189 | Over-heal loops | Low | Do not expand |
| Release automation | Host `fusion-update` | **Harden / reimplement** | Activate+mirror | systemd | High if single authority | Medium | Medium | Appsolino-only | State drift (today) | Low | Fix identity |
| Surgical installers | Phase 1 overlay scripts | **Retire** after packaged | Emergency gate | Host | Temporary | High | — | — | Becomes dependency | Low | ISS-REL-005 |
| Heartbeats | LLM heartbeats | **Replace** with events | Cost/latency | Track #1399 | High | Medium | Medium | Upstream | Missed events | Low | Phase 7 |

## Explicit decisions summary

- **Keep:** native providers, native Git, bubblewrap, GitHub-centered source
- **Harden:** coordinator, self-healing (narrow), worktrees, release automation, schema gates
- **Wrap:** model gateway, OTel stack, optional Docker workers, self-hosted Actions runner
- **Replace:** LLM maintenance heartbeats (with event wakeups); embedded PG for production
- **Disable:** production source-compile; surgical overlays (post-acceptance); shared mutable pnpm store
- **Reconsider later:** Temporal/Restate, ephemeral VMs, rootless container task pool
