---
"@tapflowio/flow-runner": minor
"@tapflowio/mcp-server": minor
"tapflow": minor
---

The MCP server and `tapflow flow run` read their token from `--token`, then `TAPFLOW_TOKEN`, then a credentials file (`~/.config/tapflow/credentials.json`, `XDG_CONFIG_HOME` or `TAPFLOW_TOKEN_FILE`) keyed by relay origin. A token the relay refuses is re-read from the file and retried once, and the MCP server reconnects with a rotated token on its next tool call, so replacing a token no longer means re-registering the server. The MCP server no longer requires a token to start: the relay decides, and a refused connection exits naming the relay and the fix. Every 401 says which relay refused which token and how to fix it. flow-runner exports `resolveToken`, `fetchWithToken`, `tokenRefusal` and `TokenSource`; `RelayClient` also takes a `TokenSource`.
