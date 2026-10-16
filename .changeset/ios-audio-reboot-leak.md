---
"@tapflowio/ios-agent": patch
---

Booting an iOS simulator that is already running stops the audio capture its last boot started before starting a new one. Each re-boot used to leave an `audiotap-helper` process and a 1.5 s poll behind, so an agent serving repeated `tapflow flow run`s or MCP connects slowed down until app installs timed out.
