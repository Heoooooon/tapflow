---
'@tapflowio/android-agent': patch
---

The Android agent reads the UI tree with `bin/tapflow-uidump.jar` (run through `app_process`, using the device's own uiautomator classes) instead of `uiautomator dump`, so a screen that never goes idle no longer fails with `could not get idle state`: the idle wait is bounded at a second and not fatal. A still screen reads in 1.3 s instead of 2.05 s (emulator). `uiautomator dump` remains the fallback for an image without those classes.
