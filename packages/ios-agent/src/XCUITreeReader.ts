import { spawn, execFile, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import { readdirSync } from 'fs'
import { join } from 'path'
import type { UIElement } from '@tapflowio/agent-core'
import { createLogger, PlatformError } from '@tapflowio/agent-core'
import { parseTreeText } from './xcuiTree.js'

const logger = createLogger('ios-agent:xcui-tree')
const execFileAsync = promisify(execFile)

const RUNNER_DIR = join(import.meta.dirname, '..', 'xctest-runner')
const PROJECT = join(RUNNER_DIR, 'TapflowTreeRunner.xcodeproj')
const BUILD_DIR = join(RUNNER_DIR, 'build')
const PRODUCTS_DIR = join(BUILD_DIR, 'Build', 'Products')
const SCHEME = 'TreeRunner'
// The in-simulator host app the UI-test runner attaches to. Terminating it ends
// the test session so the HTTP port is released (killing the xcodebuild wrapper
// alone does not tear the in-simulator process down).
const RUNNER_HOST_BUNDLE = 'dev.tapflow.treerunner.host'
// Fixed port: xcodebuild does not propagate host env to the in-simulator test
// runner, so a per-udid port can't be passed this way. A single resident runner
// (guarded below) means no collision; concurrent multi-device is deferred (Q8).
const PORT = 22087

interface RunnerHandle {
  proc: ChildProcess
  udid: string
  port: number
}

// Native-tooling boundary (xcodebuild/xcrun). Injectable so tests can mock the
// native calls without exercising the runner lifecycle / signal handling.
export interface RunnerNative {
  xctestrunReady(): boolean
  build(destination: string): Promise<void>
  spawn(destination: string, port: number): ChildProcess
  terminateHost(udid: string): void
}

const defaultNative: RunnerNative = {
  xctestrunReady() {
    // test-without-building needs the .xctestrun, not just the .app — gate on it.
    try {
      return readdirSync(PRODUCTS_DIR).some((f) => f.endsWith('.xctestrun'))
    } catch {
      return false
    }
  },
  async build(destination) {
    await execFileAsync(
      'xcodebuild',
      ['build-for-testing', '-project', PROJECT, '-scheme', SCHEME, '-destination', destination, '-derivedDataPath', BUILD_DIR, '-quiet'],
      { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 },
    )
  },
  spawn(destination, port) {
    return spawn(
      'xcodebuild',
      ['test-without-building', '-project', PROJECT, '-scheme', SCHEME, '-destination', destination, '-derivedDataPath', BUILD_DIR, '-quiet'],
      { env: { ...process.env, TAPFLOW_TREE_PORT: String(port) }, stdio: 'ignore', detached: true },
    )
  },
  terminateHost(udid) {
    execFile('xcrun', ['simctl', 'terminate', udid, RUNNER_HOST_BUNDLE], () => { /* best-effort */ })
  },
}

function refused(e: unknown): boolean {
  return (e as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED'
}

async function answers(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok
  } catch {
    return false
  }
}

// Drives the resident XCUITest tree runner: builds it once, launches it (staying
// resident), and queries GET /tree over the simulator-shared loopback. Replaces
// the AXUIElement path (UITreeReader), which required a Simulator.app window.
export class XCUITreeReader {
  private runner?: RunnerHandle
  private building?: Promise<void>
  private starting?: Promise<RunnerHandle>
  private startingUdid?: string
  // Bumped by stop(). A launch that was building when the device went away must not spawn afterwards:
  // `test-without-building` boots a shut-down simulator, which would power a device back up right after
  // someone shut it down.
  private generation = 0

  constructor(private readonly native: RunnerNative = defaultNative) {}

  private destination(udid: string): string {
    // No arch — xcodebuild resolves it (arm64 on Apple Silicon, x86_64 on Intel).
    return `platform=iOS Simulator,id=${udid}`
  }

  private async ensureBuilt(udid: string): Promise<void> {
    if (this.native.xctestrunReady()) return
    if (this.building) return this.building
    this.building = (async () => {
      logger.info('building tree runner (first run — cached afterwards)...')
      await this.native.build(this.destination(udid))
      logger.info('tree runner built')
    })()
    try {
      await this.building
    } catch (e) {
      throw new PlatformError(
        `failed to build the UI-tree runner — ensure Xcode and an iOS simulator runtime are installed (xcode-select -p): ${(e as Error).message.slice(0, 300)}`,
      )
    } finally {
      this.building = undefined
    }
  }

  private runnerAlive(h: RunnerHandle | undefined): h is RunnerHandle {
    // `signalCode` too: a runner killed from outside (by signal) keeps `exitCode` null and `killed` false, and
    // without it every read went on asking a dead port for as long as the agent ran.
    return !!h && h.proc.exitCode === null && h.proc.signalCode === null && !h.proc.killed
  }

  private async ensureRunner(udid: string): Promise<RunnerHandle> {
    // Serialize concurrent callers so we never double-spawn or hand back an
    // un-ready runner (a second caller must await waitReady, not just the object).
    // A loop, not one wait: two callers that both waited out another device's
    // launch would otherwise both start their own, on the same port.
    for (;;) {
      if (this.runnerAlive(this.runner) && this.runner.udid === udid) return this.runner
      if (!this.starting) break
      const h = await this.starting.catch(() => undefined)
      if (h && this.runnerAlive(h) && h.udid === udid) return h
    }
    const starting = this.launchRunner(udid)
    this.starting = starting
    this.startingUdid = udid
    try {
      return await starting
    } finally {
      if (this.starting === starting) {
        this.starting = undefined
        this.startingUdid = undefined
      }
    }
  }

  /**
   * Start the runner before anything asks for a tree, for a device an automation client just booted. A cold
   * start is about 3 s on a running simulator and 8–9 s right after a boot (iOS 26.5), and on the first query
   * that time is spent inside the step's selector timeout (10 s by default). Manual sessions are not warmed:
   * they never read the tree, and the runner costs about 520 MB per device.
   *
   * Skipped while a runner is alive or starting, because there is one runner for every device: warming this
   * device must not take it from another that is reading. A read during the warm-up waits on the same launch.
   */
  warm(udid: string): void {
    if (this.starting) return
    const held = this.runnerAlive(this.runner) ? this.runner : undefined
    if (held && held.udid !== udid) return
    const generation = this.generation
    // A runner already serving this device may have died with a simulator shut down outside tapflow, while its
    // xcodebuild lingers for up to a minute and still looks alive: ask it before keeping it.
    const check = held ? answers(held.port).then((ok) => { if (!ok && this.runner === held) this.stop() }) : Promise.resolve()
    check.then(() => this.ensureRunner(udid)).catch((e: Error) => {
      // Stopped on purpose (the device was shut down mid-start) is not a fault worth sending anyone to Xcode for.
      if (this.generation !== generation) logger.debug(`tree runner warm-up for ${udid} cancelled: ${e.message}`)
      else logger.warn(`tree runner warm-up for ${udid} failed; the first query will try again: ${e.message}`)
    })
  }

  private async launchRunner(udid: string): Promise<RunnerHandle> {
    this.stop() // tear down any stale/other-udid runner first
    const generation = this.generation
    await this.ensureBuilt(udid)
    if (this.generation !== generation) throw new PlatformError('tree runner start cancelled — the runner was stopped while it was being built')
    const proc = this.native.spawn(this.destination(udid), PORT)
    proc.on('error', (e) => logger.error('tree runner process error:', e.message))
    const handle: RunnerHandle = { proc, udid, port: PORT }
    this.runner = handle
    await this.waitReady(handle)
    return handle
  }

  private async waitReady(handle: RunnerHandle): Promise<void> {
    // A clock, not an iteration count: a refused connection fails at once, so the count would set the cap
    // through the sleep below.
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (!this.runnerAlive(handle)) {
        if (this.runner === handle) this.runner = undefined
        throw new PlatformError('tree runner exited before becoming ready — check Xcode/simulator state')
      }
      try {
        const r = await fetch(`http://localhost:${handle.port}/health`, { signal: AbortSignal.timeout(1000) })
        if (r.ok) return
      } catch {
        /* not listening yet */
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    this.stop()
    throw new PlatformError('tree runner did not become ready in time')
  }

  async read(udid: string, bundleId: string): Promise<UIElement[]> {
    if (!bundleId) throw new PlatformError('UI tree query needs a foreground app — launch an app first')
    const handle = await this.ensureRunner(udid)
    let text: string
    try {
      const r = await fetch(`http://localhost:${handle.port}/tree?bundleId=${encodeURIComponent(bundleId)}`, { signal: AbortSignal.timeout(10_000) })
      if (!r.ok) throw new PlatformError(`tree runner returned HTTP ${r.status} for ${bundleId}`)
      text = await r.text()
    } catch (e) {
      if (e instanceof PlatformError) throw e
      // Nothing listening: the runner died (with its simulator, shut down outside tapflow) while xcodebuild lingers,
      // so `runnerAlive` still says yes. Drop it, or every read until xcodebuild exits fails the same way. A timeout
      // is not this: a runner on a screen that never goes idle is slow, not gone.
      if (refused(e) && this.runner === handle) this.stop()
      throw new PlatformError(`UI tree query failed: ${(e as Error).message}`)
    }
    // Guard against a garbage / wrong-bundleId body silently parsing to an empty
    // tree — consumers must see an error, never a false "screen has no elements".
    if (!text.includes('Element subtree:') && !text.includes('Application,')) {
      throw new PlatformError(`tree runner returned an unexpected response for ${bundleId} — is the app running in the foreground?`)
    }
    return parseTreeText(text)
  }

  // Stop the resident runner regardless of which device it serves.
  stop(): void {
    this.generation++
    const handle = this.runner
    if (!handle) return
    this.runner = undefined
    this.killHandle(handle)
  }

  // Stop only if the runner currently serves this device — so shutting down one
  // booted device does not kill another device's runner.
  stopIfDevice(udid: string): void {
    // Or is starting one for it: until the spawn, `runner` does not name the device yet.
    if (this.runner?.udid === udid || this.startingUdid === udid) this.stop()
  }

  private killHandle(handle: RunnerHandle): void {
    const { proc, udid } = handle
    const pid = proc.pid
    // detached spawn → the child leads its own group; kill the whole group.
    try {
      if (pid) process.kill(-pid, 'SIGTERM')
      else proc.kill('SIGTERM')
    } catch {
      /* already gone */
    }
    // The in-simulator test host is not in that group — terminate it so the HTTP
    // port is released instead of lingering.
    this.native.terminateHost(udid)
    // SIGKILL fallback if SIGTERM did not take.
    const timer = setTimeout(() => {
      try {
        if (pid) process.kill(-pid, 'SIGKILL')
      } catch {
        /* gone */
      }
    }, 3000)
    timer.unref?.()
  }
}
