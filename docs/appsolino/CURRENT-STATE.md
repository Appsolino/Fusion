# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-07-31T04:15:05Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `cb91e5ab42e1c97f9b7e18bbe35f4af868316019` |
| Active Host D release | `v1a2-0.74.0-beta.5-3bc46bffe` |
| Executable SHA-256 | `4d58e8a1205a0334e6506427bc588a2ac6e76f2aa01b852610b93dedee0d2829` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`a.anas.bz` authenticated) |
| Staging result | V1A.2 **PASS WITH OBSERVATIONS**; **G1 / V1A.3 BLOCKED** (no real-provider credential) |
| Upstream vs `main` | ahead **34** / behind **323** (merge-base `b85a5d453…`) — observation only |
| Host P state | Not reserved / not accessed / **deferred** |
| Legacy production | DEGRADED / FROZEN — untouched |

## Current blockers

1. **G1 / V1A.3** — non-production real-provider credential absent; global `testMode=true` forces mock/scripted; `auth.json` empty; `secrets.env` has DB keys only. No G1 task was created (mock is not valid evidence).
2. **GitHub Issues disabled** on `Appsolino/Fusion` — durable incident tickets cannot be filed until Issues are enabled (or an agreed alternate tracker).
3. **AUTO-1…AUTO-3** — not implemented.
4. Upstream monitor is **read-only detection** (successful post-G0 run `30603446410`).

## Open high-priority issues

| Issue | Topic | Status |
| --- | --- | --- |
| *(tracker unavailable)* | G1 credential blocker — recorded in this file until Issues are enabled | OPEN |

## Automation capabilities

| Capability | State |
| --- | --- |
| Upstream detection (read-only job summary) | Proven by successful run `30603446410` |
| Upstream integration PR / merge `--no-ff` | **NOT IMPLEMENTED** |
| Risk classification + Correction A/B gates | **NOT IMPLEMENTED** |
| Safe auto-merge / sensitive owner approval | **NOT IMPLEMENTED** |
| Automated Host D immutable release + rollback | **NOT IMPLEMENTED** |
| Host P / production automation | **Disabled** (human-gated; V1B deferred) |

## Milestone board

```text
G0 — Governance alignment: COMPLETE
G1 — Real provider proof: BLOCKED (credentials / testMode)
AUTO-1…AUTO-3: NOT STARTED
AUTO-4: NOT STARTED
V1B: DEFERRED
```

## Next authorised mission

**Still G1** after the owner:

1. Enables Issues on `Appsolino/Fusion` (or designates another durable tracker);
2. Provisions one **non-production** real-provider credential into the staging auth/secret store (not Git);
3. Sets `testMode=false` and confirms configured provider/model;
4. Re-runs the disposable-repo physical-edit proof on candidate `3bc46bffe…`.

Do not start AUTO-1+, upstream catch-up, Host P, or governance redesign.
