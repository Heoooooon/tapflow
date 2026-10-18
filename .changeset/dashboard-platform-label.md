---
"@tapflowio/relay": patch
---

Dashboard: platform badges in App Center's build rows and in Settings → Apps, and the QA session's "No agents available for …" line, read `iOS`, `Android` and `Both`. They read `Ios`, or `ios` in the QA session line, because the lowercase API value was shown as it came, with only CSS capitalization on the badges.
