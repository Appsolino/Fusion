# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-07-31T11:40:00Z

| Field | Value |
| --- | --- |
| Current `main` SHA | `8c5de412a` (PR pending: `d1e7cc423` ISS-UI-001) |
| Active Host D release | `issui001-0.74.0-beta.5-d1e7cc423` |
| Executable SHA-256 | `42638380f1ace0a05d366e26e458f8232e93a78fb685415a181b2b40e866dd8e` |
| Staging health | `ok` / `0.74.0-beta.5` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Staging result | **ISS-UI-001 deployed; pending normal Chrome/Edge acceptance** (G1 still PASS on prior `g13b` preserved) |
| Host P state | Deferred |
| Legacy production | DEGRADED / FROZEN |

## Provider posture

| Item | Status |
| --- | --- |
| Default AI provider | **Cursor CLI** (`cursor-cli` / `composer-2.5`) |
| DeepSeek | Stored; **not used for G1** |
| Fallback during G1 | unset / unused |
| `testMode` | `false` |

## G1 result (2026-07-31)

| Item | Value |
| --- | --- |
| Task ID | `KB-003` (do not retry `KB-001`) |
| Configured | `cursor-cli` / `composer-2.5` |
| Actual runtime | `cursor` plugin runtime (`Using runtime "cursor"`) |
| DeepSeek / fallback / mock | NO |
| Edits | `provider-proof.txt` exact; `notes.txt` line once; README unchanged |
| Merge note | Auto-merge blocked on missing `main` while repo default is `master`; agent commit `173793d` fast-forwarded onto `master` for physical proof |

## Current blockers

1. **ISS-UI-001** — Settings search autofill. Source fix + Host D release `issui001-0.74.0-beta.5-d1e7cc423` deployed (engine paused). **Not FIXED until normal Chrome/Edge saved-profile acceptance.** Issue #23.
2. **ISS-GIT-007** — Auto-merge assumes `main` while disposable default was `master` (KB-003). Recorded; fix before AUTO-1. Do not fix inside ISS-UI-001.
3. **AUTO-1…AUTO-3** — not implemented.

## Milestone board

```text
G0: COMPLETE
ISS-CLI-004: FIXED
ISS-CLI-005: FIXED (routing + Cursor print-mode + eager install/plugins staging)
G1 physical-edit: PASS (KB-003)
AUTO-1…AUTO-4: NOT STARTED
```

## Next authorised mission

Permanent **ISS-UI-001** Settings autofill fix. Do not start AUTO-1 until that lands.
