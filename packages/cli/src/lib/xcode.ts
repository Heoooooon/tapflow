import { execSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'

export const DEFAULT_XCODE_APP = '/Applications/Xcode.app'

const SELECT_TIMEOUT_MS = 10_000

/**
 * The Xcode bundle the active developer directory points into, or null when it points at the
 * Command Line Tools, at nothing, or at a bundle that is gone.
 *
 * `xcode-select` is a real binary, not one of the `/usr/bin` shims, so calling it on a Mac without
 * Xcode does not raise the Command Line Tools install dialog that `xcrun` and `xcodebuild` do. It
 * also honours `DEVELOPER_DIR`.
 */
export function selectedXcodeApp(): string | null {
  let dir: string
  try {
    dir = String(execSync('xcode-select -p', { encoding: 'utf8', stdio: 'pipe', timeout: SELECT_TIMEOUT_MS }) ?? '').trim()
  } catch {
    return null
  }
  const app = /^(.+\.app)\/Contents\/Developer\/?$/.exec(dir)?.[1]
  return app && existsSync(app) ? app : null
}

/**
 * The Xcode bundle to use: the selected one, then `/Applications/Xcode.app`, then the first
 * `Xcode*.app` in `/Applications` by name that has a `Contents/Developer` — the `xcodes` GUI is
 * `Xcodes.app`, which matches the name and is not an Xcode.
 *
 * Not only `Xcode.app`, because installers that keep several versions side by side name the bundle
 * after its version (`xcodes` installs `Xcode-27.0.0.app`). The order is the one `touch-helper` and
 * `screencapture-helper` use to find SimulatorKit, so the CLI and the helpers agree on which Xcode
 * a Mac with two of them has.
 */
export function findXcodeApp(): string | null {
  const selected = selectedXcodeApp()
  if (selected) return selected
  if (existsSync(DEFAULT_XCODE_APP)) return DEFAULT_XCODE_APP
  try {
    const app = readdirSync('/Applications')
      .sort()
      .find((name) => /^Xcode.*\.app$/.test(name) && existsSync(`/Applications/${name}/Contents/Developer`))
    return app ? `/Applications/${app}` : null
  } catch {
    return null
  }
}
