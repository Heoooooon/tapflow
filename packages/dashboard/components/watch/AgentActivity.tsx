import { useEffect, useRef } from 'react'
import {
  CornerDownLeft, Download, Eraser, House, Keyboard, Link2, MousePointerClick, MoveHorizontal, MoveVertical, Play, Scaling,
  type LucideIcon,
} from 'lucide-react'
import { actionText, type WatchedAction } from '@/lib/watchActions'
import type { WatchActionKind } from '@tapflowio/protocol'

/**
 * What the holder has done since this page started watching (A2), oldest first so it reads as it happened: a step's
 * name as a divider (shadcn's Marker, separator variant), the actions under it as lines with an icon (shadcn's
 * Trace). Both are Base UI components and this package is Radix on Tailwind 3, so the look is rebuilt here rather
 * than installed. The time is a tooltip: the page is live, and the order already says when.
 *
 * A plain list: the `core` a11y level this package keeps does not ask for announcing each new line.
 */
export function AgentActivity({ actions, driver }: { actions: WatchedAction[]; driver: string }) {
  const lines = [...actions].reverse()
  const box = useRef<HTMLDivElement>(null)
  // Follows the newest line while the reader is at the bottom; leaves them where they are once they scroll up.
  const pinned = useRef(true)
  useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [actions])

  return (
    <section aria-labelledby="agent-activity-title" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <h2 id="agent-activity-title" className="text-sm font-medium">Agent activity</h2>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="min-h-48 flex-1 overflow-y-auto rounded-xl border bg-background px-5 py-4"
      >
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet. What the {driver} does appears here as it happens.</p>
        ) : (
          <ol className="flex flex-col gap-2.5 text-sm">
            {lines.map(({ id, at, action }) => {
              const time = new Date(at).toLocaleTimeString()
              if (action.kind === 'label') {
                return (
                  <li key={id} title={time} className="flex items-center gap-3 py-1.5 text-foreground">
                    <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-border" />
                    <span className="max-w-[80%] truncate">{action.label}</span>
                    <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-border" />
                  </li>
                )
              }
              const Icon = iconFor(action)
              return (
                <li key={id} title={time} className="flex min-w-0 items-center gap-2.5">
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{actionText(action)}</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}

function iconFor(a: Exclude<WatchActionKind, { kind: 'label' }>): LucideIcon {
  switch (a.kind) {
    case 'tap': return MousePointerClick
    case 'swipe': return Math.abs(a.to[0] - a.from[0]) > Math.abs(a.to[1] - a.from[1]) ? MoveHorizontal : MoveVertical
    case 'key': return CornerDownLeft
    case 'button': return House
    case 'type': return Keyboard
    case 'pinch': return Scaling
    case 'launch': return Play
    case 'install': return Download
    case 'clear-state': return Eraser
    case 'open-url': return Link2
  }
}
