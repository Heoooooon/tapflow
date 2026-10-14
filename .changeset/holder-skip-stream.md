---
"@tapflowio/protocol": minor
"@tapflowio/relay": patch
"@tapflowio/mcp-server": patch
"@tapflowio/flow-runner": patch
"tapflow": patch
---

`session:start` takes `stream: false` from a client that does not read the device stream, and the relay then sends that holder no frames (video or audio); watchers are unaffected. The MCP server always joins this way, and the flow runner does when no stream listener is set before joining (`tapflow flow run` without video recording). An older relay drops the key and keeps sending.
