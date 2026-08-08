---
"@runfusion/fusion": patch
---

summary: Keep package-staged plugin reloads working after Host D restarts with a read-only cache.
category: fix
dev: SOAK-R3 follow-up — unique pid/time reload-cache filenames + chmod 0600 so 0444 copyFile modes cannot EACCES on restart overwrite.
