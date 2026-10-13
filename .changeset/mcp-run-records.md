---
"@tapflowio/mcp-server": minor
---

`list_runs` and `get_run` read the run records `tapflow flow run` leaves on the relay. `get_run` returns each flow's steps, failure message, failure kind and file path, and the screenshot of each failed flow (up to 4) as an image, so a coding agent can repair a failed flow and replay it with `run_flow`. Read-only; needs a `view`-scope token.
