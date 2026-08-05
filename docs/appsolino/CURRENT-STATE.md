# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-05T16:05:00Z

| Field | Value |
| --- | --- |
| Programme tracking | Issue [#78](https://github.com/Appsolino/Fusion/issues/78) |
| Live `main` SHA | `d82c01cb9c868a8baa5c68eed6c30adce63df2f0` (docs #106; absorb #93 `7c62e652e56dd3fa04755f547ba7456213ba1dd8`) |
| Integrated upstream | Runfusion `8120c07b6a074755f44ed22f066b40eaeb19f199` |
| Active Host D release | `auto3-0.75.1-beta.1-7c62e652e56d` |
| Previous rollback release | `auto3-0.74.0-beta.6-16f24ed3b473` |
| Schema ceiling | **0044** |
| Staging health | `ok` / `0.75.1-beta.1` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Host P state | **accessed=NO — prohibited** |
| Operating mode | **CONTINUOUS UPSTREAM MAINTENANCE** · FULL AUTONOMOUS HOST-D path proved |

## Steward enablement

| Gate | State |
| --- | --- |
| s1aAutoHandoff | ON (Gate A proved) |
| s0HandoffS1a | ON (Gate B proved) |
| s1bEnabled | ON |
| s2Enabled | ON |
| s3Enabled | ON |

## Owner priority

```text
DONE:    Programme #78 Host-D autonomy path (dual-review → gates → absorb → AUTO-3)
HOLD:    Host P / production — PROHIBITED
OPEN:    (none blocking) — #105 repair in flight when this doc trails main
```
