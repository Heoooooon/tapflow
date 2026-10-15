import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { XCUITreeReader, type RunnerNative } from '../XCUITreeReader'

// A fake child process with no real pid, so killHandle never touches a real OS
// process group (it falls back to proc.kill()).
function fakeProc() {
  const p = new EventEmitter() as EventEmitter & { pid?: number; exitCode: number | null; signalCode: string | null; killed: boolean; kill: () => boolean }
  p.pid = undefined
  p.exitCode = null
  p.signalCode = null
  p.killed = false
  p.kill = vi.fn(() => { p.killed = true; return true })
  return p
}

const TREE = [
  "Attributes: Application, 0x1, pid: 1, label: 'App'",
  'Element subtree:',
  " →Application, 0x1, pid: 1, label: 'App'",
  '    Window (Main), 0x2, {{0.0, 0.0}, {100.0, 200.0}}',
  "      Button, 0x3, {{0.0, 0.0}, {50.0, 20.0}}, identifier: 'ok', label: 'OK'",
].join('\n')

function makeNative(overrides: Partial<RunnerNative> = {}): RunnerNative & {
  spawn: ReturnType<typeof vi.fn>
  terminateHost: ReturnType<typeof vi.fn>
  build: ReturnType<typeof vi.fn>
} {
  return {
    xctestrunReady: () => true, // skip the build
    build: vi.fn(async () => {}),
    spawn: vi.fn(() => fakeProc()),
    terminateHost: vi.fn(),
    ...overrides,
  } as RunnerNative & { spawn: ReturnType<typeof vi.fn>; terminateHost: ReturnType<typeof vi.fn>; build: ReturnType<typeof vi.fn> }
}

describe('XCUITreeReader', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) =>
      url.includes('/health')
        ? ({ ok: true } as Response)
        : ({ ok: true, text: async () => TREE } as Response),
    )
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('spawns the runner once and returns parsed elements', async () => {
    const native = makeNative()
    const reader = new XCUITreeReader(native)
    const els = await reader.read('udid-A', 'com.app')
    expect(native.spawn).toHaveBeenCalledTimes(1)
    expect(els.find((e) => e.identifier === 'ok')?.label).toBe('OK')
    reader.stop()
  })

  it('serializes concurrent reads into a single spawn (mutex)', async () => {
    const native = makeNative()
    const reader = new XCUITreeReader(native)
    const [a, b] = await Promise.all([reader.read('udid-A', 'com.app'), reader.read('udid-A', 'com.app')])
    expect(native.spawn).toHaveBeenCalledTimes(1)
    expect(a.length).toBe(b.length)
    reader.stop()
  })

  it('rejects a garbage body instead of returning an empty tree', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/health') ? ({ ok: true } as Response) : ({ ok: true, text: async () => '<html>error</html>' } as Response),
    )
    const reader = new XCUITreeReader(makeNative())
    await expect(reader.read('udid-A', 'com.app')).rejects.toThrow(/unexpected response/)
    reader.stop()
  })

  it('stopIfDevice stops only the matching device', async () => {
    const native = makeNative()
    const reader = new XCUITreeReader(native)
    await reader.read('udid-A', 'com.app')
    reader.stopIfDevice('udid-B') // different device → no-op
    expect(native.terminateHost).not.toHaveBeenCalled()
    reader.stopIfDevice('udid-A') // matches → stop
    expect(native.terminateHost).toHaveBeenCalledWith('udid-A')
  })

  describe('warm', () => {
    it('starts the runner before any read, and a read during the warm-up joins it', async () => {
      const native = makeNative()
      const reader = new XCUITreeReader(native)
      reader.warm('udid-A')
      const els = await reader.read('udid-A', 'com.app')
      expect(native.spawn).toHaveBeenCalledTimes(1)
      expect(els.length).toBeGreaterThan(0)
      reader.stop()
    })

    it('leaves a runner that serves another device alone', async () => {
      const native = makeNative()
      const reader = new XCUITreeReader(native)
      await reader.read('udid-A', 'com.app')
      reader.warm('udid-B')
      // Past any health probe and launch the warm-up could start.
      await new Promise((r) => setTimeout(r, 10))
      expect(native.spawn).toHaveBeenCalledTimes(1)
      expect(native.terminateHost).not.toHaveBeenCalled()
      reader.stop()
    })

    it('does not spawn for a device shut down while the runner was being built', async () => {
      let finishBuild!: () => void
      const native = makeNative({ xctestrunReady: () => false })
      native.build.mockImplementation(() => new Promise<void>((r) => { finishBuild = r }))
      const reader = new XCUITreeReader(native)
      reader.warm('udid-A')
      await vi.waitFor(() => expect(native.build).toHaveBeenCalled())
      reader.stopIfDevice('udid-A')
      finishBuild()
      await new Promise((r) => setTimeout(r, 0))
      // `test-without-building` boots a shut-down simulator: spawning here would power the device back up.
      expect(native.spawn).not.toHaveBeenCalled()
    })
  })

  it('starts one runner for two reads that both waited out another device\'s start', async () => {
    const native = makeNative()
    const reader = new XCUITreeReader(native)
    const a = reader.read('udid-A', 'com.app')
    const [b1, b2] = [reader.read('udid-B', 'com.app'), reader.read('udid-B', 'com.app')]
    await Promise.all([a.catch(() => {}), b1, b2])
    // One for A, one for B — not a second B on the same port, orphaned.
    expect(native.spawn).toHaveBeenCalledTimes(2)
    reader.stop()
  })

  it('waits for the runner on the clock, not a count of polls', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/health')) throw new Error('ECONNREFUSED')
        return { ok: true, text: async () => TREE } as Response
      })
      const reader = new XCUITreeReader(makeNative())
      const read = reader.read('udid-A', 'com.app')
      let settled = false
      read.then(() => { settled = true }, () => { settled = true })
      // A refused connection fails at once, so a count of polls would have given up long before 60 s.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(settled).toBe(false)
      fetchMock.mockImplementation(async (url: string) =>
        url.includes('/health') ? ({ ok: true } as Response) : ({ ok: true, text: async () => TREE } as Response))
      await vi.advanceTimersByTimeAsync(500)
      await expect(read).resolves.not.toHaveLength(0)
      reader.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a new runner when the last one was killed from outside', async () => {
    const native = makeNative()
    const reader = new XCUITreeReader(native)
    await reader.read('udid-A', 'com.app')
    // What `pkill xcodebuild` leaves: a signal, no exit code, and `killed` false since this process did not kill it.
    native.spawn.mock.results[0]!.value.signalCode = 'SIGTERM'
    await reader.read('udid-A', 'com.app')
    expect(native.spawn).toHaveBeenCalledTimes(2)
    reader.stop()
  })

  describe('a runner that stopped answering (its simulator was shut down outside tapflow)', () => {
    const refused = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })

    it('is dropped on a refused read, so the next read starts a new one', async () => {
      const native = makeNative()
      const reader = new XCUITreeReader(native)
      await reader.read('udid-A', 'com.app')
      fetchMock.mockImplementationOnce(async () => { throw refused() })
      await expect(reader.read('udid-A', 'com.app')).rejects.toThrow(/fetch failed/)
      await reader.read('udid-A', 'com.app')
      expect(native.spawn).toHaveBeenCalledTimes(2)
      reader.stop()
    })

    it('is kept on a read that timed out — slow is not gone', async () => {
      const native = makeNative()
      const reader = new XCUITreeReader(native)
      await reader.read('udid-A', 'com.app')
      fetchMock.mockImplementationOnce(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') })
      await expect(reader.read('udid-A', 'com.app')).rejects.toThrow(/timeout/)
      await reader.read('udid-A', 'com.app')
      expect(native.spawn).toHaveBeenCalledTimes(1)
      reader.stop()
    })

    it('is replaced by a warm-up for the same device', async () => {
      const native = makeNative()
      const reader = new XCUITreeReader(native)
      await reader.read('udid-A', 'com.app')
      fetchMock.mockImplementationOnce(async () => { throw refused() })
      reader.warm('udid-A')
      await vi.waitFor(() => expect(native.spawn).toHaveBeenCalledTimes(2))
      reader.stop()
    })

    it('is kept by a warm-up when it still answers', async () => {
      const native = makeNative()
      const reader = new XCUITreeReader(native)
      await reader.read('udid-A', 'com.app')
      reader.warm('udid-A')
      await new Promise((r) => setTimeout(r, 10))
      expect(native.spawn).toHaveBeenCalledTimes(1)
      expect(native.terminateHost).not.toHaveBeenCalled()
      reader.stop()
    })
  })

  it('throws without a bundleId', async () => {
    const reader = new XCUITreeReader(makeNative())
    await expect(reader.read('udid-A', '')).rejects.toThrow(/foreground app/)
  })
})
