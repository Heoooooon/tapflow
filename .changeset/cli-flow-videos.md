---
"@tapflowio/flow-runner": minor
"tapflow": minor
---

A recorded `tapflow flow run` now sends each flow's video to the relay beside the run record, cut from the device stream the runner already receives; the dashboard will play it in a later release. Video never changes a run's result: it has its own queue, a refused or slow video call prints one line and the record carries on, and at the end of a run the record is sent first. The runner asks iOS agents for H.264 while recording. flow-runner exports `VideoTap`, `RelayClient.setStreamListener`, a `bootDevice` option `acceptH264`, and an engine option `onStep`.
