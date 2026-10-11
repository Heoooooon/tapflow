---
"@tapflowio/flow-runner": minor
"tapflow": minor
"@tapflowio/relay": minor
---

A recorded `tapflow flow run` now keeps the screen each passed flow ended on, as the evidence that it passed, and the dashboard's Flow Runs page shows it under the flow. The flow runner's engine takes `captureLastScreen` and returns `lastScreenshot`; it is off by default, so MCP's `run_flow` is unchanged.
