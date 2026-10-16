---
"@tapflowio/ios-agent": patch
---

UI tree frames are clipped to the screen and an element wholly off it is left out, as on Android, so a screen with content scrolled or animated off it no longer makes flow-runner and the MCP server refuse the whole tree (`invalid response shape`). The far edge is rounded down, so `x + width` never passes 1.
