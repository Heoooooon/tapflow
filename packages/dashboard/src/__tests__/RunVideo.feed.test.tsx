import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MutableRefObject } from 'react'
import type { BinaryFrameHandler, FrameMeta } from '@/lib/envelope'

// What the replay feeds the decoder (A4). A decoder may hold its last output until more input arrives, so a
// picture shown while paused is flushed — and a flushed WebCodecs decoder takes only a keyframe next, so playing
// starts from a fresh feed rather than continuing.

const fed: { meta: FrameMeta | undefined; replay: boolean }[] = []
vi.mock('@/components/device/WatchedDevice', () => ({
  WatchedDevice: ({ binaryFrameHandlerRef, replay }: { binaryFrameHandlerRef: MutableRefObject<BinaryFrameHandler | undefined>; replay?: boolean }) => {
    binaryFrameHandlerRef.current = (_d, meta) => { fed.push({ meta, replay: replay === true }) }
    return <div data-testid="device" />
  },
}))

import { RunVideo } from '@/components/runs/RunVideo'
import { useDecoderStream } from '@/hooks/useDecoderStream'
import { withQuery } from './withQuery'

const enc = (kind: number, ms: number, payload: Uint8Array) => {
  const out = new Uint8Array(9 + payload.length)
  const v = new DataView(out.buffer)
  v.setUint8(0, kind); v.setUint32(1, ms); v.setUint32(5, payload.length)
  out.set(payload, 9)
  return out
}
const frame = (key: boolean) => {
  const out = new Uint8Array(26)
  out.set([0x54, 0x46, 0x46, 0x45, 1, key ? 0x03 : 0x01])
  return out
}

afterEach(() => { fed.length = 0; vi.unstubAllGlobals() })

describe('the replay feed', () => {
  it('flushes the last frame of a paused seek only, and feeds afresh without a flush when play starts', async () => {
    const parts = [enc(1, 0, frame(true)), enc(1, 100, frame(false)), enc(1, 200, frame(false))]
    const file = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let o = 0
    for (const p of parts) { file.set(p, o); o += p.length }
    const index = {
      meta: { formatVersion: 1, codec: 'h264', platform: 'ios', clockBase: 1, flowStartMs: 100 },
      bytes: file.length, ended: true, endReason: 'done', evicted: false,
      chunks: [{ seq: 0, offset: 0, length: file.length, startMs: 0, keyframe: true }], gaps: [],
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/index') ? Response.json(index) : new Response(file))))
    render(withQuery(<RunVideo runId="r" idx={0} flowName="f" summary={{ ended: true, endReason: 'done', evicted: false, notRecorded: null, bytes: 1 }} running={false} />))
    await userEvent.click(screen.getByRole('button', { name: /Play the video/ }))
    await screen.findByTestId('device')

    // Opened at the flow's start (100 ms): the keyframe and the frame at 100, the second flushed.
    expect(fed.map((f) => [f.meta?.keyframe, f.meta?.flush])).toEqual([[true, false], [false, true]])
    expect(fed.every((f) => f.replay)).toBe(true)

    fed.length = 0
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(fed[0]?.meta).toMatchObject({ keyframe: true, flush: false })
    expect(fed.some((f) => f.meta?.flush)).toBe(false)
  })
})

describe('useDecoderStream', () => {
  it('flushes the decoder after a frame marked flush, and never otherwise', async () => {
    const decoder = { decode: vi.fn(), flush: vi.fn(), close: vi.fn(), onResize: vi.fn(), surface: document.createElement('canvas'), size: null }
    vi.doMock('@/lib/decoders/pickDecoder', () => ({ pickDecoder: () => decoder }))
    vi.resetModules()
    const { useDecoderStream: hook } = await import('@/hooks/useDecoderStream')
    const ref: { current: BinaryFrameHandler | undefined } = { current: undefined }
    renderHook(() => hook({ binaryFrameHandlerRef: ref, frameCount: { current: 0 }, onDecoderReady: () => {}, onResize: () => {}, onUnsupported: () => {} }))
    ref.current!(new ArrayBuffer(4), { codec: 1, keyframe: true })
    expect(decoder.flush).not.toHaveBeenCalled()
    ref.current!(new ArrayBuffer(4), { codec: 1, keyframe: false, flush: true })
    expect(decoder.flush).toHaveBeenCalledTimes(1)
    vi.doUnmock('@/lib/decoders/pickDecoder')
    void useDecoderStream
  })
})
