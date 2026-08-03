---
"@runfusion/fusion": patch
---

summary: Fix a rare stall where a requeued task deleted in the same moment never re-dispatched.
category: fix
dev: Scheduler `task:moved` now updates the `recentEngineTodoRequeues` settle-window ledger and the dispatch-oscillation reset synchronously in the emitter prologue (sync `parked` lanes) instead of behind `await resolveTaskParkedColumns`. FN-8656 had moved them behind the await, racing the synchronous `task:deleted`/`task:updated` handlers so a hold requeue immediately followed by a delete could re-set the guard after the clear and strand the card. Restores the two failing `todo-inprogress-flapping.test.ts` invariants.
