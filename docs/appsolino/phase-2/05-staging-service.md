# Staging service

## Unit

- Name: `fusion-staging.service`
- User/Group: `fusion:fusion`
- Exec: `/opt/appsolino-fusion/staging/current/fn dashboard --host 127.0.0.1 --port 4140 --paused --no-auth --no-supervise`
- Environment files: `/etc/appsolino-fusion/staging/fusion.env`, `secrets.env`
- `UMask=0027`, `NoNewPrivileges=no`, `ProtectSystem=off`
- WorkingDirectory / HOME / FUSION_HOME under staging state paths only
- Does not invoke `pnpm` / `tsx` / TypeScript sources

## Release install

- Immutable: `/opt/appsolino-fusion/staging/releases/phase2a-0.74.0-beta.5-040b61e8873e/`
- Symlink: `/opt/appsolino-fusion/staging/current` → that directory
- Packaged version: **0.74.0-beta.5**
- Executable SHA-256: `54e2cd933281ca523e57303c578c4e14b60cd5914006fac8c9145703a39a0c48`

## Health

- Script: `/usr/local/sbin/staging-health-check.sh`
- Timer: `fusion-staging-health.timer`
- Textfile: `/var/lib/node_exporter/textfile_collector/appsolino_fusion_staging.prom`

## Network

- Listener: `127.0.0.1:4140` only
- UFW: SSH 22 only publicly allowed; no public 4140
- External probe to public IP:4140: blocked / non-reachable

## Evidence

`evidence/11-*`, `evidence/12-health-now.json`, `evidence/13-health-check.log`, `evidence/10-*`
