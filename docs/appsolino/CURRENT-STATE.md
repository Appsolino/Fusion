# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-07-31T08:15:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `a53635e8b` (includes merged PR #22) |
| Active Host D release | `v1a2-0.74.0-beta.5-3bc46bffe` |
| Executable SHA-256 | `4d58e8a1205a0334e6506427bc588a2ac6e76f2aa01b852610b93dedee0d2829` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`a.anas.bz` authenticated) |
| Staging result | V1A.2 **PASS WITH OBSERVATIONS**; **G1.1** historical Anthropic path noted; **owner default = Cursor CLI**; **G1 physical-edit BLOCKED** pending Cursor CLI install/auth |
| Upstream vs `main` | observation-only monitor OK (run `30603446410`) |
| Host P state | Not reserved / not accessed / **deferred** |
| Legacy production | DEGRADED / FROZEN — untouched |

## Provider posture (owner decision)

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (required for G1 and ongoing default) |
| DeepSeek API key | **Stored** via Authentication portal; **runtime compatibility not proven** — do not select for G1; test separately after G1 |
| Anthropic | **Not required** for G1 |
| Fallback during G1 | **Forbidden** (`fallbackProvider` unset) |

## Current blockers

1. **ISS-UI-001** — normal Settings UI blocked by browser email autofill of Search Settings. Temporary workaround: Chrome Guest / Edge InPrivate. Permanent source fix + regression tests required **after G1 and before AUTO-1**. Register: [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md). Issue: https://github.com/Appsolino/Fusion/issues/23
2. **G1** — install and authenticate **Cursor CLI** on Host D, set it as default (`useCursorCli` / cursor-cli provider+model), `testMode=false`, **no fallback**, then one physical-edit proof. Issue: https://github.com/Appsolino/Fusion/issues/21
3. **AUTO-1…AUTO-3** — not implemented.

## Open high-priority issues

| Issue | Topic | Status |
| --- | --- | --- |
| https://github.com/Appsolino/Fusion/issues/23 | ISS-UI-001 Settings search autofill | OPEN / REGRESSION |
| https://github.com/Appsolino/Fusion/issues/21 | G1 Cursor CLI install/auth required | OPEN / BLOCKED |

## Automation capabilities

| Capability | State |
| --- | --- |
| Upstream detection (read-only) | Proven (`30603446410`) |
| Upstream integration / Host D auto-release | **NOT IMPLEMENTED** |
| Host P automation | **Disabled** |

## Milestone board

```text
G0: COMPLETE
G1.1 provider inspection: PASS (historical; Anthropic path identified — superseded by owner Cursor CLI decision)
G1 physical-edit proof: BLOCKED (Cursor CLI install/authentication on Host D)
DeepSeek: credential stored; runtime unproven; deferred after G1
AUTO-1…AUTO-4: NOT STARTED (after G1; ISS-UI-001 permanent fix before AUTO-1)
V1B: DEFERRED
```

## Next authorised mission

Install/authenticate **Cursor CLI** on Host D and complete **G1 physical-edit proof** with fallback disabled. Do not use DeepSeek or Anthropic for that attempt. Then permanent ISS-UI-001 fix; then AUTO-1+.
