import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldError } from '@/components/ui/field-error'
import { FieldHint } from '@/components/ui/field-hint'
import { FormErrorCount } from '@/components/ui/form-error-count'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { queryKeys } from '@/lib/queries'
import type { WorkspaceSettings } from '@/lib/types'

const GB = 1024 * 1024 * 1024
/** The relay's bounds (`settings.ts`): 0–365 days, 100 MB–10 TB. */
const MIN_CAP_GB = 0.1
const MAX_CAP_GB = 10240

const schema = z.object({
  retentionDays: z.coerce.number().int('Whole days only').min(0, 'At least 0 days').max(365, 'At most 365 days'),
  capGb: z.coerce.number().min(MIN_CAP_GB, `At least ${MIN_CAP_GB} GB`).max(MAX_CAP_GB, `At most ${MAX_CAP_GB} GB`),
})
type FormData = z.infer<typeof schema>

function formatGb(bytes: number): string {
  const gb = bytes / GB
  return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`
}

/**
 * How long flow run videos are kept and how much room they may take (A4) — Admin only, like the workspace.
 * Failed flows' videos are kept as long as their run; only passed ones have a window. The cap shown in effect is
 * the smaller of the setting and what the disk can give while keeping its floor free.
 */
export function VideoStorageCard({ settings }: { settings: WorkspaceSettings }) {
  const queryClient = useQueryClient()
  const form = useForm<z.input<typeof schema>, unknown, FormData>({
    shouldFocusError: false, // FormErrorCount focuses, once the field is described (#824)
    resolver: zodResolver(schema),
    values: settings.video_pass_retention_days !== undefined && settings.video_storage_cap_mb !== undefined
      ? { retentionDays: settings.video_pass_retention_days, capGb: Math.round((settings.video_storage_cap_mb / 1024) * 10) / 10 }
      : undefined,
    resetOptions: { keepDirtyValues: true },
  })
  const errors = form.formState.errors

  async function onSave(data: FormData) {
    const body = new FormData()
    body.append('video_pass_retention_days', String(data.retentionDays))
    body.append('video_storage_cap_mb', String(Math.round(data.capGb * 1024)))
    try {
      const res = await fetch('/api/v1/settings', { method: 'PATCH', credentials: 'include', body })
      if (!res.ok) { toast.error('Failed to update video storage'); return }
      toast.success('Video storage updated')
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings })
    } catch {
      toast.error('Failed to update video storage')
    }
  }

  // A relay older than flow videos has none of these fields: nothing to configure there.
  if (settings.video_storage_cap_mb === undefined) return null
  const capBytes = settings.video_storage_cap_mb * 1024 * 1024
  const effective = settings.video_effective_cap_bytes ?? capBytes
  const usage = settings.video_usage_bytes ?? 0

  return (
    <Card>
      <CardHeader><CardTitle>Flow run videos</CardTitle></CardHeader>
      <CardContent>
        {/* noValidate: the browser's own bubble would stop the submit before the schema's message, which is the one
            tied to the field. min/max stay on the inputs for the spinner and the mobile keypad. */}
        <form noValidate onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Using <span className="font-medium text-foreground">{formatGb(usage)}</span> of {formatGb(effective)}.
            {effective < capBytes && ' The disk has less room than the limit below, so that is the limit in effect.'}
          </p>
          <div className="grid gap-2">
            <Label htmlFor="video-retention">Keep passed flows&apos; videos for (days)</Label>
            <Input
              id="video-retention"
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              className="w-32"
              aria-invalid={!!errors.retentionDays}
              aria-describedby={errors.retentionDays ? 'video-retention-error' : 'video-retention-hint'}
              {...form.register('retentionDays')}
            />
            {errors.retentionDays
              ? <FieldError id="video-retention-error" message={errors.retentionDays?.message} />
              : <FieldHint id="video-retention-hint">A failed flow&apos;s video is kept as long as its run. 0 removes passed flows&apos; videos at the next daily clean-up.</FieldHint>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="video-cap">Storage for videos (GB)</Label>
            <Input
              id="video-cap"
              type="number"
              inputMode="decimal"
              step={0.1}
              min={MIN_CAP_GB}
              max={MAX_CAP_GB}
              className="w-32"
              aria-invalid={!!errors.capGb}
              aria-describedby={errors.capGb ? 'video-cap-error' : 'video-cap-hint'}
              {...form.register('capGb')}
            />
            {errors.capGb
              ? <FieldError id="video-cap-error" message={errors.capGb?.message} />
              : <FieldHint id="video-cap-hint">When it is full, passed flows&apos; videos are removed first, oldest first. The relay also keeps 1 GB or 10% of the disk free, whichever is larger.</FieldHint>}
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
          <FormErrorCount errors={errors} submitCount={form.formState.submitCount} />
        </form>
      </CardContent>
    </Card>
  )
}
