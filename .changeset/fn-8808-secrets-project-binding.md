---
"@runfusion/fusion": patch
---

summary: Bind dashboard secret management to the selected project.
category: fix
dev: Secrets routes now reject requests without an explicit projectId before fallback context resolution.
