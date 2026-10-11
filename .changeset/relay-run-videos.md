---
"@tapflowio/relay": minor
---

Relay: flow run videos (`/api/v1/runs/:id/flows/:idx/video`) — a runner opens a flow's video, sends numbered chunks and ends it; anyone who may view reads the chunk index and byte ranges. Videos live in `run-videos/` beside `uploads/`, are capped per flow and by a team-wide storage cap (default 20 GB, never closer to a full disk than 1 GB or 10%), and passed flows' videos are kept 3 days by default; both are team settings. The flow runner and dashboard will use them in the next releases.
