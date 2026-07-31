# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-07-31T08:36:23Z

| Field | Value |
| --- | --- |
| Current `main` SHA | (see `git rev-parse origin/main`) |
| Active Host D release | `v1a2-0.74.0-beta.5-3bc46bffe` |
| Executable SHA-256 | `4d58e8a1205a0334e6506427bc588a2ac6e76f2aa01b852610b93dedee0d2829` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` |
| Staging result | V1A.2 PASS WITH OBSERVATIONS; **G1.2a BLOCKED** (Cursor CLI service-HOME auth) |
| Host P state | Deferred |
| Legacy production | DEGRADED / FROZEN |

## Provider posture (owner decision)

| Item | Status |
| --- | --- |
| Default AI provider (required) | **Cursor CLI** |
| DeepSeek API key | Stored/Active; **not for G1**; runtime unproven for G1 |
| Anthropic | Not required for G1 |
| Fallback during G1 | Forbidden |

## Current blockers

1. **ISS-UI-001** — Settings search autofill. Workaround: Guest/InPrivate. Issue #23. Permanent fix after G1 / before AUTO-1.
2. **ISS-CLI-004 / G1** — Cursor CLI authenticated under `/home/fusion`, but `fusion-staging` uses `HOME=.../fusion-home`, so discovery yields no `cursor-cli` models; picker shows DeepSeek only. “Use default” does **not** route to Cursor CLI. Issue #21.
3. **AUTO-1…AUTO-3** — not implemented.

## Open high-priority issues

| Issue | Topic | Status |
| --- | --- | --- |
| https://github.com/Appsolino/Fusion/issues/23 | ISS-UI-001 Settings autofill | OPEN / REGRESSION |
| https://github.com/Appsolino/Fusion/issues/21 | G1 / ISS-CLI-004 Cursor CLI service HOME | OPEN / BLOCKED |

## Milestone board

```text
G0: COMPLETE
G1.1: PASS (historical)
G1.2a Cursor routing preflight: BLOCKED (ISS-CLI-004)
G1 physical-edit: NOT STARTED
AUTO-1…AUTO-4: NOT STARTED
V1B: DEFERRED
```

## Next authorised mission

Authenticate `cursor-agent` under the staging service HOME (or align HOME), confirm `/api/models` lists `cursor-cli` models, set explicit `defaultProvider=cursor-cli` + model (no fallback, DeepSeek not selected), then run G1 physical-edit once.
