# Appsolino Fusion — current state

**Authority:** Only authoritative live status. Other docs must link here, not copy these fields.

**Last updated UTC:** 2026-08-06T06:24:10Z

| Field | Value |
| --- | --- |
| Active programme | Issue [#109](https://github.com/Appsolino/Fusion/issues/109) — Host D trust-hardening |
| Prior programmes | [#78](https://github.com/Appsolino/Fusion/issues/78) CLOSED · [#105](https://github.com/Appsolino/Fusion/issues/105) CLOSED |
| Closure baseline main | `eb88a526c7aeba804cd0972ef1a43f4a606d23d6` (#108 merge; look up live tip with `git fetch && git rev-parse origin/main`) |
| Integrated upstream | Runfusion `8120c07b6a074755f44ed22f066b40eaeb19f199` |
| Active Host D release | `auto3-0.75.1-beta.1-7c62e652e56d` |
| Schema ceiling | **0044** |
| Staging health | `ok` / `0.75.1-beta.1` @ `127.0.0.1:4140` (`enginePaused=true`) |
| Host P state | **accessed=NO — prohibited** |
| Operating mode | **HOST-D TRUST HARDENING** · continuous automation continues |

## Steward enablement

| Gate | State |
| --- | --- |
| s1aAutoHandoff | ON |
| s0HandoffS1a | ON |
| s1bEnabled | ON |
| s2Enabled | ON |
| s3Enabled | ON |

## Owner priority

```text
NOW:     Host D trust-hardening (#109) — test / fault-inject / repair / soak
HOLD:    Host P / production — PROHIBITED
CLOSED:  Programme #78 · Issue #105
```
