# Environment separation

| Env | Purpose | Paths |
|-----|---------|-------|
| Build | source, deps, package | `/srv/appsolino-fusion/build`, `/source`, `/cache/pnpm` |
| Staging | packaged runtime | `/opt/appsolino-fusion/staging/*`, `/etc/appsolino-fusion/staging`, `/srv/appsolino-fusion/staging/*`, `/run/appsolino-fusion/staging` |
| Production | reserved docs only on Host D | `/opt|etc|srv/appsolino-fusion/production` — **must not exist** |

Staging secrets reject production URL markers. Build must not use staging `FUSION_HOME`.
