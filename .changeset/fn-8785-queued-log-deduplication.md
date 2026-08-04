---
"@runfusion/fusion": patch
---

summary: Prevent repeated dependency and file-scope queue activity entries for unchanged blockers.
category: fix
dev: Queue episode signatures are durable and project/task transaction-serialized across scheduler, executor, and recovery producers.
