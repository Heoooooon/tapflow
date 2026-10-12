import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pause, Play, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TechLabel } from '@/components/ui/tech-label'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { WatchedDevice } from '@/components/device/WatchedDevice'
import { parseEnvelopeHeader, CODEC_AUDIO, HEADER_SIZE, type BinaryFrameHandler } from '@/lib/envelope'
import {
  chromeAt, formatClock, loadVideo, seekChunk, snapToStep, videoEndNote, videoUnavailableText,
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
  /** A seek waiting for the remount. `flush`: present the target now — right for a still picture, and wrong while
   *  playing, since after a flush the decoder accepts only a keyframe and playback continues with the frames after. */
  const pendingSeek = useRef<{ ms: number; flush: boolean } | null>({ ms: start, flush: true })
  /** A pointer is on the seek bar: what lets a drag catch on a step, and the arrow keys not. */
  const dragging = useRef(false)

  // In useCallback because both effects below depend on them.
  const deliver = useCallback((upTo: number, flushLast = false) => {
    const records = video.records
    let i = clock.current.next
    let last = -1
    for (let j = i; j < records.length && records[j]!.ms <= upTo; j++) if (records[j]!.kind === 'frame') last = j
    while (i < records.length && records[i]!.ms <= upTo) {
      const r = records[i]!
      if (r.kind === 'frame') {
        const env = parseEnvelopeHeader(r.data)
        if (env?.codec !== CODEC_AUDIO) {
          handlerRef.current?.(
            env ? r.data.slice(HEADER_SIZE) : r.data,
            env ? { codec: env.codec, keyframe: env.keyframe, capturedAt: env.capturedAt, flush: flushLast && i === last } : undefined,
          )
        }
      }
      i++
    }
    clock.current.next = i
  }, [video])

  const seek = useCallback((ms: number, flush: boolean) => {
    pendingSeek.current = { ms: Math.max(0, Math.min(ms, video.durationMs)), flush }
    setShownMs(pendingSeek.current.ms)
    setEpoch((e) => e + 1)
  }, [video])

  // After a (re)mount the new screen's handler is in place — child effects run first — so the decoder is fed from
  // the keyframe before the target, up to it.
  useEffect(() => {
    const target = pendingSeek.current
    if (target === null) return
    pendingSeek.current = null
    const from = seekChunk(video, target.ms)
    clock.current = { ms: target.ms, next: from >= 0 ? video.chunkStarts[from]! : video.records.length }
    deliver(target.ms, target.flush)
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
        seek(video.chunks[next.chunk]!.startMs, false)
        return
      }
      clock.current.ms = Math.min(target, video.durationMs)
      deliver(clock.current.ms)
      if (now - lastUi >= UI_TICK_MS || clock.current.ms >= video.durationMs) {
        lastUi = now
        setShownMs(clock.current.ms)
      }
      if (clock.current.ms >= video.durationMs) {
        // Stopped on the last frame: shown by the same path as a paused seek, so it is the last one and not the one before.
        setPlaying(false)
        seek(video.durationMs, true)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, video, deliver, seek, epoch])

  const toggle = () => {
    if (playing) { setPlaying(false); return }
    // A paused picture was flushed, and a flushed decoder takes only a keyframe next: play starts from a fresh feed.
    seek(clock.current.ms >= video.durationMs ? start : clock.current.ms, false)
    setPlaying(true)
  }

  const chrome = chromeAt(video, shownMs) as ChromePayload | null
  const pct = (ms: number) => `${video.durationMs > 0 ? (ms / video.durationMs) * 100 : 0}%`
  const endNote = videoEndNote(index.endReason)
  // Dragging catches on a step's start. Pointer only: with the arrow keys a catch would hold the thumb on the step
  // and never let it past.
  const snap = (ms: number) => (dragging.current ? snapToStep(video, ms) : ms)

  return (
    <div className="flex flex-col gap-3">
      <div role="region" aria-label={`Video of ${flowName}`} className="w-fit origin-top-left" style={{ zoom: 0.6 }}>
        <WatchedDevice
          key={epoch}
          chrome={chrome}
          deviceReady
          platform={video.meta.platform ?? 'ios'}
          binaryFrameHandlerRef={handlerRef}
          replay
        />
      </div>
      <div className="flex max-w-xl flex-col gap-2">
        {/* Marks above the bar: a dot where each step starts (red where it failed), a bar where frames never reached
            the relay. Hover or focus says which; a click goes there. Inset by the thumb's radius, so a mark sits over
            the thumb's centre at that time — Radix keeps the thumb inside the track. */}
        <TooltipProvider delayDuration={150}>
          <div className="relative mx-2.5 h-2">
            {video.gaps.map((g, i) => (
              <Tooltip key={`g${i}`}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${formatClock(g.fromMs)} to ${formatClock(g.toMs)}: did not reach the relay`}
                    onClick={() => seek(g.toMs, !playing)}
                    className="absolute top-0 h-2 rounded-full bg-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ left: pct(g.fromMs), width: `max(8px, calc(${pct(g.toMs)} - ${pct(g.fromMs)}))` }}
                  />
                </TooltipTrigger>
                <TooltipContent>{formatClock(g.fromMs)}–{formatClock(g.toMs)} · did not reach the relay</TooltipContent>
              </Tooltip>
            ))}
            {video.steps.map((st) => (
              <Tooltip key={`s${st.index}`}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${formatClock(st.ms)} ${st.name}${st.status === 'failed' ? ', failed' : ''}`}
                    onClick={() => seek(st.ms, !playing)}
                    className={`absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${st.status === 'failed' ? 'bg-destructive' : 'bg-muted-foreground'}`}
                    style={{ left: pct(st.ms) }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {formatClock(st.ms)} · {st.name}{st.status === 'failed' && <span className="font-medium"> · failed</span>}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
        <Slider
          min={0}
          max={Math.max(1, video.durationMs)}
          step={50}
          value={[shownMs]}
          onPointerDown={() => { dragging.current = true }}
          onValueChange={([v]) => seek(snap(v ?? 0), !playing)}
          onValueCommit={() => { dragging.current = false }}
          aria-label={`Position in the video of ${flowName}`}
          aria-valuetext={`${formatClock(shownMs)} of ${formatClock(video.durationMs)}`}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
          </Button>
          <TechLabel className="text-muted-foreground">{formatClock(shownMs)} / {formatClock(video.durationMs)}</TechLabel>
          <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v) as (typeof SPEEDS)[number])}>
            <SelectTrigger aria-label="Playback speed" className="ml-auto h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SPEEDS.map((sp) => <SelectItem key={sp} value={String(sp)}>{sp}×</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {(endNote || (running && !index.ended)) && (
          <p className="text-xs text-muted-foreground">
            {[endNote, running && !index.ended ? 'Still recording: reload the video for the rest.' : null].filter(Boolean).join(' ')}
          </p>
        )}
      </div>
    </div>
  )
}
