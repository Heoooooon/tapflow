import type { WatchedAction } from '@/lib/watchActions'

/**
 * Where the holder just tapped or swiped (A2), drawn over the device for a moment. `place` turns a point on the
 * device's screen (0–1, as on the wire) into a position in the overlay's own box — that box is the whole device
 * frame on iOS and the screen on Android, so the conversion is the platform's.
 */
export function TapMarks({ marks, place }: {
  marks: WatchedAction[]
  place: (x: number, y: number) => { left: number; top: number }
}) {
  return (
    <div aria-hidden="true" data-testid="tap-marks" className="pointer-events-none absolute inset-0" style={{ zIndex: 12 }}>
      {marks.map(({ id, action }) => {
        if (action.kind === 'tap') {
          const p = place(action.x, action.y)
          return (
            <span
              key={id}
              data-testid="tap-mark"
              className="absolute size-8 rounded-full border-2 border-white/90 bg-white/30 shadow-[0_0_0_1px_rgba(0,0,0,0.35)] motion-safe:animate-[tap-mark_0.9s_ease-out_forwards]"
              style={{ left: `${p.left * 100}%`, top: `${p.top * 100}%`, transform: 'translate(-50%, -50%)' }}
            />
          )
        }
        if (action.kind === 'swipe') {
          const a = place(...action.from)
          const b = place(...action.to)
          return (
            <svg key={id} data-testid="swipe-mark" className="absolute inset-0 size-full overflow-visible motion-safe:animate-[swipe-mark_0.9s_ease-out_forwards]">
              <line
                x1={`${a.left * 100}%`} y1={`${a.top * 100}%`} x2={`${b.left * 100}%`} y2={`${b.top * 100}%`}
                stroke="white" strokeOpacity={0.85} strokeWidth={4} strokeLinecap="round"
              />
              <circle cx={`${b.left * 100}%`} cy={`${b.top * 100}%`} r={7} fill="white" fillOpacity={0.85} />
            </svg>
          )
        }
        return null
      })}
    </div>
  )
}
