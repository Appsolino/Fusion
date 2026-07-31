# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-07-31T05:56:39Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `321b2643d9c4b10ac7a6be00552dbfc1e8afb094` |
| Active Host D release | `v1a2-0.74.0-beta.5-3bc46bffe` |
| Executable SHA-256 | `4d58e8a1205a0334e6506427bc588a2ac6e76f2aa01b852610b93dedee0d2829` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`a.anas.bz` authenticated) |
| Staging result | V1A.2 **PASS WITH OBSERVATIONS**; **G1 BLOCKED** (credential); **G1.1 PASS** (provider path identified) |
| Upstream vs `main` | observation-only monitor OK (run `30603446410`) |
| Host P state | Not reserved / not accessed / **deferred** |
| Legacy production | DEGRADED / FROZEN — untouched |

## Current blockers

1. **G1** — needs one non-production **Anthropic API key** on Host D staging, then `testMode=false`, then physical-edit proof. Recommended path from G1.1 (pinned `3bc46bffe…`): Dashboard → Settings → Authentication → **Anthropic API Key** (`POST /api/auth/api-key` provider `anthropic-api-key` → stores under auth.json key `anthropic`). Issue: https://github.com/Appsolino/Fusion/issues/21
2. **AUTO-1…AUTO-3** — not implemented.
3. Upstream monitor is read-only detection only.

## Open high-priority issues

| Issue | Topic | Status |
| --- | --- | --- |
| https://github.com/Appsolino/Fusion/issues/21 | G1 credential blocker (Anthropic API key) | OPEN |

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
G1 physical-edit proof: BLOCKED (waiting on owner credential + testMode=false)
AUTO-1…AUTO-4: NOT STARTED
V1B: DEFERRED
```

## Next authorised mission

**G1 physical-edit proof** after owner provisions a non-production Anthropic API key and clears `testMode` (engine remains paused until verification). No AUTO / Host P / rebuild required for that path.
