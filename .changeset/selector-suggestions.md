---
"@tapflowio/flow-runner": minor
"tapflow": minor
"@tapflowio/relay": minor
"@tapflowio/mcp-server": patch
---

A `tapOn` that matches nothing or several elements carries up to three suggested lines on its failed step (`StepResult.suggestions`), each verified to tap exactly one element on the screen it failed on. `tapflow flow run` prints them as `try:` lines and records them; the relay stores them whole (an over-long one is dropped, never cut) and the run page shows them with a copy button; `get_run` passes them to an agent. Not for `assertVisible`. An input field is suggested by its `id`, never its label.
