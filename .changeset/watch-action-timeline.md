---
"@tapflowio/protocol": minor
"@tapflowio/relay": minor
"@tapflowio/flow-runner": minor
"@tapflowio/mcp-server": patch
"tapflow": patch
---

A session's watchers get `watch:action`: what its holder did, built by the relay from the input and app commands it passed on (tap or swipe at the gesture's end, key with character keys unnamed, button on release, typing as a character count, launch, install, clear-state, open-url without the URL) and from the holder's optional `session:activity` label. flow-runner exports `activityLabel(step)`, a step's name with typed text, URLs and character keys left out, and `onStep` carries it on a step's start; `RelayClient.activity` sends it. `tapflow flow run` and the MCP server's `run_flow` send one per step. The watch page lists the last 100 and marks taps and swipes on the device.
