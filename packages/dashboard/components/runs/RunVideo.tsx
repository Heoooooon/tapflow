import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pause, Play, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TechLabel } from '@/components/ui/tech-label'
import { WatchedDevice } from '@/components/device/WatchedDevice'
import { parseEnvelopeHeader, CODEC_AUDIO, HEADER_SIZE, type BinaryFrameHandler } from '@/lib/envelope'
import {
  chromeAt, formatClock, loadVideo, seekChunk, videoEndNote, videoUnavailableText,
  type LoadedVideo, type VideoIndex, type VideoSummary,
} from '@/lib/runVideo'
import { getRunVideo, queryKeys } from '@/lib/queries'
import type { ChromePayload } from '@/lib/types'

const SPEEDS = [0.5, 1, 2, 4] as const
/** How often the clock and scrubber re-render while playing; frames are delivered on every animation frame. */
const UI_TICK_MS = 100

/**
 * A flow's video on the run page (A4): the whole flow, replayed inside the same device frame the live viewer draws.
 *
 * **Loaded when asked for, not with the page.** A flow's video is megabytes; a run of ten flows would download them
 * all to show a list. The summary on the run (`flow.video`) says whether there is one and why not.
 */
export function RunVideo({ runId, idx, flowName, summary, running }: {
  runId: string
  idx: number
  flowName: string
  summary: VideoSummary
  /** The flow is still being recorded: what has arrived plays, and the page says more is coming. */
  running: boolean
}) {
  const [requested, setRequested] = useState(false)
  const videoQuery = useQuery({
    queryKey: queryKeys.runVideo(runId, idx),
    // Parsed once, here: the file is megabytes, and parsing it in render would redo that on every re-render.
    queryFn: async ({ signal }) => {
      const r = await getRunVideo(runId, idx, signal)
      return r.kind === 'ready' ? { kind: 'ready' as const, index: r.index, video: loadVideo(r.index, r.file) } : r
    },
    enabled: requested,
    // Megabytes, and a recorded video does not change: kept for as long as the page is open, never refetched on focus.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const unavailable = videoUnavailableText(summary)
  if (unavailable) return <p className="text-xs text-muted-foreground">{unavailable}</p>

  const loaded = videoQuery.data
  if (loaded?.kind === 'ready') {
    return <Player video={loaded.video} index={loaded.index} flowName={flowName} running={running} />
  }
  const loading = requested && videoQuery.isFetching
  const answer = loaded?.kind === 'gone' ? 'Video no longer kept.'
    : loaded?.kind === 'unsupported' ? 'This video was recorded in a format this dashboard cannot play. Update the relay to play it.'
    : videoQuery.isError ? 'Couldn\'t load the video. Try again.'
    : ''

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        aria-disabled={loading}
        className="aria-disabled:opacity-50"
        onClick={() => {
          if (loading) return
          if (videoQuery.isError) void videoQuery.refetch()
          else setRequested(true)
        }}
      >
        <Video className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {loading ? 'Loading the video…' : 'Play the video'}
      </Button>
      <TechLabel className="text-muted-foreground">{formatBytes(summary.bytes)}</TechLabel>
      {running && <span className="text-xs text-muted-foreground">Still recording: it plays what has arrived so far.</span>}
      <span role="status" className="text-xs text-muted-foreground">{answer}</span>
    </div>
  )
}

function startsAfterGap(video: LoadedVideo, chunk: number): boolean {
  return chunk > 0 && video.chunks[chunk]!.seq !== video.chunks[chunk - 1]!.seq + 1
}

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

/**
 * **A replay wrapper around the live decoder, not a new decoder.** The device screens decode whatever reaches their
 * frame handler and never reset, so a seek, and a jump over a gap, remounts the screen (a new decoder) and feeds it
 * from the last decodable keyframe at or before the target — at once, so the picture is right when it settles —
 * then paces frames by their recorded time.
 */
function Player({ video, index, flowName, running }: { video: LoadedVideo; index: VideoIndex; flowName: string; running: boolean }) {
  const handlerRef = useRef<BinaryFrameHandler | undefined>(undefined)
  const start = Math.min(video.meta.flowStartMs, video.durationMs)
  const [epoch, setEpoch] = useState(0)
  const [shownMs, setShownMs] = useState(start)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  /** Playback position and the next record to deliver; refs, because the animation loop reads them every frame. */
  const clock = useRef({ ms: start, next: 0 })
  const pendingSeek = useRef<number | null>(start)

  // In useCallback because both effects below depend on them.
  const deliver = useCallback((upTo: number) => {
    const records = video.records
    let i = clock.current.next
    while (i < records.length && records[i]!.ms <= upTo) {
      const r = records[i]!
      if (r.kind === 'frame') {
        const env = parseEnvelopeHeader(r.data)
        if (env?.codec !== CODEC_AUDIO) {
          handlerRef.current?.(env ? r.data.slice(HEADER_SIZE) : r.data, env ? { codec: env.codec, keyframe: env.keyframe, capturedAt: env.capturedAt } : undefined)
        }
      }
      i++
    }
    clock.current.next = i
  }, [video])

  const seek = useCallback((ms: number) => {
    pendingSeek.current = Math.max(0, Math.min(ms, video.durationMs))
    setShownMs(pendingSeek.current)
    setEpoch((e) => e + 1)
  }, [video])

  // After a (re)mount the new screen's handler is in place — child effects run first — so the decoder is fed from
  // the keyframe before the target, up to it.
  useEffect(() => {
    const target = pendingSeek.current
    if (target === null) return
    pendingSeek.current = null
    const from = seekChunk(video, target)
    clock.current = { ms: target, next: from >= 0 ? video.chunkStarts[from]! : video.records.length }
    deliver(target)
  }, [epoch, video, deliver])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    let lastUi = 0
    const tick = (now: number) => {
      const target = clock.current.ms + (now - last) * speed
      last = now
      // Entering the first chunk after a gap: the decoder cannot continue across missing frames, so start it afresh
      // there. Once restarted the clock is at that chunk's start, so this does not fire twice.
      const next = video.records[clock.current.next]
      if (next && next.ms <= target && clock.current.next === video.chunkStarts[next.chunk]
        && startsAfterGap(video, next.chunk) && clock.current.ms < video.chunks[next.chunk]!.startMs) {
        seek(video.chunks[next.chunk]!.startMs)
        return
      }
      clock.current.ms = Math.min(target, video.durationMs)
      deliver(clock.current.ms)
      if (now - lastUi >= UI_TICK_MS || clock.current.ms >= video.durationMs) {
        lastUi = now
        setShownMs(clock.current.ms)
      }
      if (clock.current.ms >= video.durationMs) { setPlaying(false); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, video, deliver, seek, epoch])

  const toggle = () => {
    if (!playing && clock.current.ms >= video.durationMs) seek(start)
    setPlaying((p) => !p)
  }

  const chrome = chromeAt(video, shownMs) as ChromePayload | null
  const failedStep = video.steps.find((s) => s.status === 'failed')
  const pct = (ms: number) => `${video.durationMs > 0 ? (ms / video.durationMs) * 100 : 0}%`
  const endNote = videoEndNote(index.endReason)

  return (
    <div className="flex flex-col gap-3">
      <div role="region" aria-label={`Video of ${flowName}`} className="w-fit origin-top-left" style={{ zoom: 0.6 }}>
        <WatchedDevice
          key={epoch}
          chrome={chrome}
          deviceReady
          platform={video.meta.platform ?? 'ios'}
          binaryFrameHandlerRef={handlerRef}
        />
      </div>
      <div className="flex max-w-xl flex-col gap-1.5">
        <div className="relative h-5">
          <input
            type="range"
            min={0}
            max={Math.max(1, video.durationMs)}
            step={50}
            value={shownMs}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label={`Position in the video of ${flowName}`}
            aria-valuetext={`${formatClock(shownMs)} of ${formatClock(video.durationMs)}`}
            className="absolute inset-0 w-full accent-primary"
          />
          {/* Marks under the thumb: where each step started, where the flow started, the failure, and what is missing. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5">
            {video.gaps.map((g, i) => (
              <span key={`g${i}`} className="absolute h-full bg-muted-foreground/40" style={{ left: pct(g.fromMs), width: `max(2px, calc(${pct(g.toMs)} - ${pct(g.fromMs)}))` }} />
            ))}
            {video.steps.map((s) => (
              <span key={`s${s.index}`} title={s.name} className={`absolute h-full w-0.5 ${s.status === 'failed' ? 'bg-destructive' : 'bg-foreground/50'}`} style={{ left: pct(s.ms) }} />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
          </Button>
          <TechLabel className="text-muted-foreground">{formatClock(shownMs)} / {formatClock(video.durationMs)}</TechLabel>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            Speed
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value) as (typeof SPEEDS)[number])}
              className="rounded-md border bg-background px-1.5 py-0.5 text-xs text-foreground"
            >
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
        </div>
        <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label={`Steps in the video of ${flowName}`}>
          {video.steps.map((s) => (
            <li key={s.index}>
              <button type="button" onClick={() => seek(s.ms)} className={`underline-offset-2 hover:underline ${s.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
                {formatClock(s.ms)} {s.name}
              </button>
            </li>
          ))}
        </ol>
        {(failedStep || video.gaps.length > 0 || endNote || running) && (
          <p className="text-xs text-muted-foreground">
            {[
              video.gaps.length > 0 ? 'Grey stretches did not reach the relay.' : null,
              endNote,
              running && !index.ended ? 'Still recording: reload the video for the rest.' : null,
            ].filter(Boolean).join(' ')}
          </p>
        )}
      </div>
    </div>
  )
}
