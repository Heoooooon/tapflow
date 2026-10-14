---
"tapflow": patch
---

`tapflow doctor` and `tapflow setup ios` find an Xcode that is not at `/Applications/Xcode.app`: the one `xcode-select -p` points into, then `/Applications/Xcode.app`, then the first `/Applications/Xcode*.app` with a `Contents/Developer`, the order the iOS helpers already use. A bundle named after its version, as `xcodes` installs it (`Xcode-27.0.0.app`), was reported as not installed, and `setup ios` tried to re-select `/Applications/Xcode.app`.
