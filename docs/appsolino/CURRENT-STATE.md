# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-07-31T06:15:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `a53635e8b` (includes merged PR #22 G1.1 recommendation) |
| Active Host D release | `v1a2-0.74.0-beta.5-3bc46bffe` |
| Executable SHA-256 | `4d58e8a1205a0334e6506427bc588a2ac6e76f2aa01b852610b93dedee0d2829` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`a.anas.bz` authenticated) |
| Staging result | V1A.2 **PASS WITH OBSERVATIONS**; **G1.1 PASS** (Anthropic API key path); **G1 physical-edit BLOCKED** pending credential entry |
| Upstream vs `main` | observation-only monitor OK (run `30603446410`) |
| Host P state | Not reserved / not accessed / **deferred** |
| Legacy production | DEGRADED / FROZEN — untouched |

## Current blockers

1. **ISS-UI-001** — normal Settings UI blocked by browser email autofill of Search Settings. Temporary workaround: Chrome Guest / Edge InPrivate. Permanent source fix + regression tests required **after G1 and before AUTO-1**. Register: [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md). Issue: https://github.com/Appsolino/Fusion/issues/23
2. **G1** — non-production Anthropic API key must be saved (use Guest/InPrivate while ISS-UI-001 is open), then `testMode=false`, then one physical-edit proof. Issue: https://github.com/Appsolino/Fusion/issues/21
3. **AUTO-1…AUTO-3** — not implemented.

## Open high-priority issues

| Issue | Topic | Status |
| --- | --- | --- |
| https://github.com/Appsolino/Fusion/issues/23 | ISS-UI-001 Settings search autofill | OPEN / REGRESSION |
| https://github.com/Appsolino/Fusion/issues/21 | G1 credential / physical-edit proof | OPEN / BLOCKED |

## Automation capabilities

| Capability | State |
| --- | --- |
| Upstream detection (read-only) | Proven (`30603446410`) |
| Upstream integration / Host D auto-release | **NOT IMPLEMENTED** |
| Host P automation | **Disabled** |

## Milestone board

```text
G0: COMPLETE
G1.1 provider inspection: PASS (recommend Anthropic API key)
G1 physical-edit proof: BLOCKED (credential entry via Guest/InPrivate while ISS-UI-001 open)
AUTO-1…AUTO-4: NOT STARTED (after G1; ISS-UI-001 permanent fix before AUTO-1)
V1B: DEFERRED
```

## Next authorised mission

1. Merge this known-issues register PR.
2. Owner saves Anthropic API key via Guest/InPrivate.
3. Complete **G1 physical-edit proof** (one attempt).
4. Then permanent ISS-UI-001 fix; then AUTO-1+.
