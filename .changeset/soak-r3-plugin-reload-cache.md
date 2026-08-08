---
"@runfusion/fusion": patch
---

summary: Load package-staged plugins via a writable reload cache on immutable Host D releases.
category: fix
dev: SOAK-R3 follow-up — PluginLoader cache-bust copies go to FUSION_HOME/plugin-reload-cache instead of beside read-only release entries; AUTO-3 requires loaded+started Cursor freshness.
