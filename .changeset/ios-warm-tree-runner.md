---
"@tapflowio/ios-agent": patch
"@tapflowio/relay": patch
---

The iOS agent starts its UI-tree runner as soon as a device a flow runner or MCP client booted is ready, instead of on the first tree query, so the first selector step after a boot no longer spends the runner's 8–9 s cold start inside its timeout. The relay tells the agent who is booting by adding `automation` to the forwarded `device:boot`; a dashboard boot is not warmed. A runner killed from outside, or left without its simulator when the simulator was shut down outside tapflow, is now replaced on the next query instead of being asked again until xcodebuild exits.
