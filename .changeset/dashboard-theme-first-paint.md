---
"@tapflowio/relay": patch
---

Dashboard: the theme is applied before the first paint, so a dark-mode reader no longer sees the page flash light while it loads. `next-themes` is patched so its `ThemeProvider` no longer renders a theme script React never runs on the client, which also removes React 19's "Encountered a script tag" console warning.
