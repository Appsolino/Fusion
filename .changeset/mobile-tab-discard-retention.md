---
"@runfusion/fusion": patch
---

summary: Dashboard survives mobile tab discards — no more white-splash reload with an empty board.
category: fix
dev: Visibility-gated every polling loop via `useVisibilityAwarePoll`; one shared `useLiveTimeTicker` replaces per-TaskCard 30s timers; sse-bus suspends channels after 60s hidden and drops `beforeunload`; service worker serves hashed `/assets/*` and fonts cache-first (`fusion-cache-v6`); SWR hydration TTLs raised (tasks/chat rooms 12h, default 6h) with an oversize-aware task snapshot writer; board scroll + view persist through an involuntary reload; log/stream buffers capped at 500; ListView and search-active board columns are now windowed; the terminal modal mounts only while open and disposes its WebGL addon. Dashboard vitest setup now clears `sessionStorage` per test so per-tab view state cannot leak between cases.
