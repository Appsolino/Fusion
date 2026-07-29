# Phase 1 — Packaged runtime gate (Candidate A-P1)

## Identity results

| Surface | Result |
|---------|--------|
| Isolated `fn --version` | `0.74.0-beta.5` |
| `/api/health` version | `0.74.0-beta.5` |
| CLI and health identical | PASS |

## Functional smoke (Phase 1B complete gate)

| Gate | Result |
|------|--------|
| Packaged CLI help | PASS |
| Dashboard startup (localhost bind) | PASS |
| Health ok | PASS |
| Task list | PASS |
| Staging task create without dispatch | PASS |
| Task show | PASS |
| Activity feed includes `task:created` | PASS |
| Migrations present (`0000`–`0036`) | PASS |
| Controlled restart | PASS |
| State persistence after restart | PASS |
| Isolated-runtime version after moving executable | PASS |

## Decision

**ACCEPTED**
