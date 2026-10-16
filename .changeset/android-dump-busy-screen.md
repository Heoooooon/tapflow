---
'@tapflowio/android-agent': patch
---

The Android agent reads the UI tree with `bin/tapflow-uidump.jar` (run through `app_process`, using the device's own uiautomator classes) instead of `uiautomator dump`, so a screen that never goes idle no longer fails with `could not get idle state`: the idle wait is bounded at a second and not fatal. Reads are about a second faster. `uiautomator dump` remains the fallback for an image without those classes.
