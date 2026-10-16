---
'@tapflowio/flow-runner': patch
'@tapflowio/android-agent': patch
'@tapflowio/mcp-server': patch
---

`launchApp` waits until the app's UI-tree structure (role, label, id of each element) holds still for a second instead of taking the first non-empty tree, so a splash is not taken for the first screen and an empty-tree app moves on after a second rather than the whole timeout; a screen that never holds still moves on 3 s after its first read. The Android agent launches with the launcher's intent through `am start -W` (bounded at 10 s, `monkey` as the fallback), so its launch reply comes after the app's first frame, or once that 10 s bound runs out. The `launch_app` MCP tool says that returning does not mean the screen is up.
