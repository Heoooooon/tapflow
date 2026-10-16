---
'@tapflowio/ios-agent': patch
---

Each iOS simulator gets its own UI-tree runner, so reading one device no longer stops another device's runner. The runner picks a free port itself, announces it, and answers `/health` with a token the agent passed, so a runner left on a port by another agent is never read from. The built runner is rebuilt when its sources or Xcode change.
