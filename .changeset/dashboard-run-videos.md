---
"@tapflowio/relay": minor
---

A run's page on the dashboard plays each flow's video inside the device frame: a seek bar with a dot where each step starts (red where it failed) and a bar where frames never reached the relay, catching on steps when dragged, with play, pause and speed. A flow without a video says why. Settings → Default gains a "Flow run videos" card for Admins: storage in use against the limit in effect, and sliders for how long passed flows' videos are kept and how much storage videos may use. The relay's run detail (`GET /api/v1/runs/:id`) carries each flow's `video` summary.
