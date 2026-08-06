# Host D trust matrix

**Programme:** [#109](https://github.com/Appsolino/Fusion/issues/109)  
**Legend:** `PASS` · `FAIL` · `BLOCKED` · `PENDING` · `N/A`

Statuses below reflect programme start + Cycle 1 kickoff. Update after each cycle.

## Product-decision blockers

| ID | Question | Blocks |
| --- | --- | --- |
| PDB-JOURNEY-SCOPE | In-engine journeys while `enginePaused=true`? | Critical journey 100% claim |
| PDB-V1A | V1A A–E still required? | Journey catalogue |
| PDB-UNPAUSE | Unpause allowed on Host D? | Any unpaused engine proof |

Automation/ops journeys proceed independently of these blockers.

## A — Installation and startup

| ID | Test | Status | Evidence |
| --- | --- | --- | --- |
| A-01 | Active immutable release identity | PASS | `/opt/appsolino-fusion/staging/current` |
| A-02 | Idempotent AUTO-3 / no-op when unchanged | PENDING | AUTO-3 run |
| A-03 | Process start (`fusion-staging.service`) | PASS | systemd + health |
| A-04 | Process restart recovery | PASS | controlled restart |
| A-05 | Config/dependency validation | PENDING | prestart scripts |

## B — Application health

| ID | Test | Status | Evidence |
| --- | --- | --- | --- |
| B-01 | `GET /api/health` → ok | PASS | :4140 |
| B-02 | Version matches release | PASS | health + RELEASE_IDENTITY |
| B-03 | DB healthy, no corruption | PASS | health.database |
| B-04 | `enginePaused=true` | PASS | /api/settings |
| B-05 | Clean critical error rate | PENDING | journal |

## C — Critical product journeys

| ID | Test | Status | Evidence |
| --- | --- | --- | --- |
| C-OPS-01 | Upstream → merge → AUTO-3 Host D path | PENDING | automation |
| C-UX-* | In-engine user journeys | BLOCKED | PDB-* |

## D — Database integrity

| ID | Test | Status | Evidence |
| --- | --- | --- | --- |
| D-01 | Schema ceiling present | PASS | migrations |
| D-02 | Staging backup create | PASS | staging-backup |
| D-03 | Restore to disposable DB | PASS | staging-restore-test |
| D-04 | AUTO-3 probe disposable DB | PENDING | auto3 probe |

## E — Deployment and rollback

| ID | Test | Status | Evidence |
| --- | --- | --- | --- |
| E-01 | Standard/idempotent staging deploy | PASS | AUTO-3 staging |
| E-02 | Proof-profile deploy | PENDING | profile=proof |
| E-03 | force_smoke_fail → ROLLED_BACK | QUEUED | AUTO-3 |
| E-04 | Previous release restored + health | PENDING | post-rollback |
| E-05 | Structured evidence complete | PASS | auto3-evidence.json |
| E-06 | Host P access false | PASS | receipt |

## F — Failure injection

| ID | Test | Status | Evidence |
| --- | --- | --- | --- |
| F-01 | Controlled app process restart | PENDING | systemctl |
| F-02 | Health negative probes | PENDING | staging-health-negative |
| F-03 | Deliberate post-activation smoke fail | PENDING | = E-03 |
| F-04 | Kill-9 / reboot / disk pressure | PENDING | harness TBD; abort limits required |

## G — Automation reliability

| ID | Test | Status | Evidence |
| --- | --- | --- | --- |
| G-01 | AUTO-1 truthful no-change or one sync | PENDING | workflow runs |
| G-02 | ≤1 active upstream sync PR | PASS | gh pr list |
| G-03 | No duplicate steward incidents | PENDING | issues |
| G-04 | No abandoned worktrees/temp refs | PENDING | worktree list |
| G-05 | Dual Cursor review path | PENDING | steward workflow |

## H — Security boundaries

| ID | Test | Status | Evidence |
| --- | --- | --- | --- |
| H-01 | Host P access count zero | PASS | ledger + receipts |
| H-02 | No write creds in review children | PENDING | dual-review policy |
| H-03 | Untrusted candidate scripts not executed | PENDING | AUTO-3 guards |

## I — Observability

| ID | Test | Status | Evidence |
| --- | --- | --- | --- |
| I-01 | health-status expected version matches live | PASS | staging/state |
| I-02 | last-deploy-result factual | PENDING | auto3 state |
| I-03 | No false terminal-marker-parse | PASS | #105 closed |

## J — Performance and stability

| ID | Test | Status | Evidence |
| --- | --- | --- | --- |
| J-01 | Establish latency/error/CPU/mem baseline | PENDING | controlled sample |
| J-02 | No uncontrolled stress | N/A | policy |

## Trust counters

See ledger `trustWindow.subsystemCounters`. Whole-window reset on HIGH/CRITICAL after fix deployed.
