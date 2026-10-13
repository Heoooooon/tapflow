---
"tapflow": minor
"@tapflowio/flow-runner": minor
---

`tapflow token set` stores the token the MCP server and `tapflow flow run` read from `~/.config/tapflow/credentials.json`, from a hidden prompt or stdin, after checking it with the relay; it is stored for `--relay`, else `TAPFLOW_RELAY_URL`, else `ws://localhost:4000` — the clients' own default. `tapflow token status` lists the relays with a stored token and whether each still works, without printing tokens. A refused token's message names the command. flow-runner exports `writeCredential` (atomic, other relays kept, symlinked or foreign-owned files refused), `listCredentials`, `CredentialFileError` and `PAT_PATTERN`.
