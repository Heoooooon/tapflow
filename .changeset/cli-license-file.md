---
"tapflow": patch
"@tapflowio/android-agent": patch
"@tapflowio/ios-agent": patch
---

The published packages carry the license texts they need. `tapflow` includes `LICENSE`, which `files` already listed but which was missing from the package directory. `@tapflowio/android-agent` and `@tapflowio/ios-agent` add `LICENSE-APACHE-2.0` and a `NOTICE` for the Apache-2.0 code they ship: scrcpy-server and the Android Emulator's `emulator_controller.proto` in the Android agent, logic derived from baguette in the iOS agent.
