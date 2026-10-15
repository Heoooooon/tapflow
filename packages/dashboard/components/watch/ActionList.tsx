import { actionText, type WatchedAction } from '@/lib/watchActions'

/**
 * What the holder has done since this page started watching (A2), newest first. A plain list: the `core` a11y level
 * this package keeps does not ask for announcing each new line, and a stream of announcements would talk over the
 * status line above the device.
 */
export function ActionList({ actions, driver }: { actions: WatchedAction[]; driver: string }) {
  return (
    <section aria-labelledby="watch-actions-title" className="flex w-80 shrink-0 flex-col gap-2">
      <h2 id="watch-actions-title" className="text-sm font-medium">Actions</h2>
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet. What the {driver} does appears here as it happens.</p>
      ) : (
        <ol className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto text-sm">
          {actions.map(({ id, at, action }) => (
            <li key={id} className="flex gap-3">
              <time dateTime={new Date(at).toISOString()} className="shrink-0 font-mono text-xs leading-5 text-muted-foreground">
                {new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </time>
              <span className={action.kind === 'label' ? 'min-w-0 break-words font-medium' : 'min-w-0 text-muted-foreground'}>
                {actionText(action)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
