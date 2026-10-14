---
"tapflow": patch
---

`tapflow doctor` and `tapflow setup ios` find an Xcode that is not at `/Applications/Xcode.app`: the one `xcode-select -p` points into, then `/Applications/Xcode.app`, then the first `/Applications/Xcode*.app` with a `Contents/Developer`. A bundle named after its version, as `xcodes` installs it (`Xcode-27.0.0.app`), was reported as not installed, and `setup ios` tried to re-select `/Applications/Xcode.app`. On a Mac where no Xcode has been selected yet, `doctor` now says to select the one it found rather than running `xcodebuild`, which would raise the Command Line Tools install dialog. When the Xcode it found is already selected and still fails, it suggests accepting the licence and running first launch instead of selecting it again.
