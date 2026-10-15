---
"@tapflowio/flow-runner": patch
---

`launchApp` now waits until the app shows a screen (the first non-empty UI tree, within the default selector timeout) before the flow moves on. The wait never fails the step: a screen with no UI tree elements (a game, a canvas, a WebView-only screen) waits out the timeout and carries on, and a tree query that fails is left to the next step to report. A coordinate step sent right after launch — `scroll`, `swipe`, `inputText`, `pressKey` — used to be acknowledged and dropped by an app that was not on screen yet, so it passed while doing nothing. A failed step's message no longer reports the runner's own query, cut off at the step's deadline, as `last query error: … aborted due to timeout` when the screen was read and the selector simply never matched.
