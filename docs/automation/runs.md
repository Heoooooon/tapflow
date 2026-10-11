---
title: Flow Runs
description: "See tapflow flow run's records on the dashboard's Flow Runs page: CI and local runs apart, each flow's result and the screen it failed on or ended on, and a link to watch the device while a run is in progress."
---

# Flow Runs

::: warning Experimental
The flow runner and its run records are part of tapflow's **AI automation axis**, which is experimental. The mature path is the manual QA dashboard.
:::

The dashboard's **Flow Runs** page shows the records `tapflow flow run` leaves. When CI runs your flows on every build, anyone on the team can see in a browser which flow failed on which build, and why. A failure in the app is kept apart from an environment problem such as the device, the agent or the relay.

A run is recorded when the runner has a token. See [Recording runs](#recording) to set it up.

## How to use {#how-to-use}

1. Open **Flow Runs** in the dashboard's sidebar. It opens on CI runs.
2. Pick where the runs came from with **All** / **CI** / **Local** at the top. You can narrow the list by status (**Any status**, **Running**, **Passed**, **Failed**, **Cancelled**) and by flow name; part of a name is enough.
3. Select a row to open that run. Cmd-click (Ctrl-click on Windows and Linux) opens it in a new tab.

The list shows 25 runs a page, newest first; **Newer** and **Older** below it move between pages.

The **Runs** button on a build row in App Center lists that build's flow runs only. The filters are part of the address, so a filtered list is a link you can share.

### A run's page {#run-detail}

A run's page lists its flows in the order they ran.

- A failed flow shows its failure message, each step's result and a screenshot from the moment it failed. A passed flow shows the screen it ended on, as the evidence that it passed: a login flow shows the screen it logged in to. Select a screenshot to open it full size.
- A flow the run never reached is marked **Not run**.
- **Open the CI run** opens the run on the CI side when the CI recorded a link to it. For a run with a build, **Other runs of this build** lists the same build's other runs.

### Watch a run in progress {#watch-a-run}

While a run is in progress, the list and the run's page refresh every few seconds. **Watch the device** on the run's page shows the device the runner is driving, live and read-only: nothing you click reaches the device. Up to 4 people can watch a session.

## What the statuses mean {#statuses}

| Status | Meaning |
|--------|---------|
| **Running** | In progress |
| **Passed** | Every flow passed |
| **Failed** | At least one flow failed. When every failure was an environment problem, the run's page says **Environment problem**; when the run failed before any flow started, it gives the reason. |
| **Cancelled** | The run was cancelled (Ctrl+C, a cancelled CI job). A run whose runner disconnected before saying it was over is shown here too, and its page says so. |

## Recording runs (operator) {#recording}

- Give `tapflow flow run` an API-type token (`view, builds:write`) and every run is recorded. Pass it with `--token` or `TAPFLOW_TOKEN`. The details are in the [Flow reference's run records](/automation/flows#run-records).
- Add `--no-record` to skip recording.
- When you run it locally, the runner prints a link to the run's page when it ends. In CI it prints the run's id only, so the relay's address stays out of the log.
- A run's record is deleted with its build; a record of a run with no build is deleted after 7 days.

## Related {#related}

- [Flow reference](/automation/flows): writing flows and the `tapflow flow run` options
- [MCP in CI/CD](/automation/mcp-ci): running flows in CI
- [Runs in the REST API](/reference/api#runs): the endpoints that write and read run records
