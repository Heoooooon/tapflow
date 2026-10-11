---
"@tapflowio/relay": minor
"tapflow": minor
---

Dashboard: a Runs page (`/automation/runs`) lists `tapflow flow run`'s records, opening on CI runs, filterable by source, status, flow name and build; a run's page shows each flow's steps, failure message and screenshot, separates app failures from environment problems, and offers **Watch the device** while the run is in progress. App Center's build rows link to their runs. The relay's `flow` filter now matches part of a name, ignoring the case of ASCII letters. `tapflow flow run` prints the run's page link when it ends, outside CI.
