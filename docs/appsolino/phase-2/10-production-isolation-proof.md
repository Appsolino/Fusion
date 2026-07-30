# Production isolation proof

## Host D constraints

- No production credentials, database URLs, systemd units, or `/opt/.../production/current` symlinks configured
- Staging role rejects production markers / known production addresses in secrets
- Staging listener and PostgreSQL are localhost-only; UFW allows SSH only
- Master plan status remains: production **DEGRADED / FROZEN** (schema 0036 / surgical ceiling 0035) — untouched by Phase 2A

## Assertions exercised

- Host separation script: PASS (`evidence/19-host-separation.log`)
- Health check rejects unexpected production paths / DB URLs
- No connection to old production server performed during this mission

## Reserved (docs only)

- `/opt/appsolino-fusion/production/`
- `/etc/appsolino-fusion/production/`
- `/srv/appsolino-fusion/production/`

These paths are not provisioned on Host D.
