import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VideoStorageCard } from '@/components/settings/VideoStorageCard'
import type { WorkspaceSettings } from '@/lib/types'
import { withQuery } from './withQuery'

const GB = 1024 * 1024 * 1024
const settings: WorkspaceSettings = {
  team_name: 'Team', logo_url: null,
  video_pass_retention_days: 3, video_storage_cap_mb: 20480, video_usage_bytes: 3.2 * GB, video_effective_cap_bytes: 20 * GB,
}

describe('VideoStorageCard', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('shows what videos use against the limit in effect, and says when the disk is the limit', () => {
    const { rerender } = render(withQuery(<VideoStorageCard settings={settings} />))
    expect(screen.getByText(/Using/).textContent).toBe('Using 3.2 GB of 20 GB.')
    rerender(withQuery(<VideoStorageCard settings={{ ...settings, video_effective_cap_bytes: 12 * GB }} />))
    expect(screen.getByText(/Using/).textContent).toContain('of 12 GB. The disk has less room than the limit below')
  })

  it('saves the window in days and the cap in MB', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    render(withQuery(<VideoStorageCard settings={settings} />))
    const days = screen.getByLabelText("Keep passed flows' videos for (days)")
    const cap = screen.getByLabelText('Storage for videos (GB)')
    expect((days as HTMLInputElement).value).toBe('3')
    expect((cap as HTMLInputElement).value).toBe('20')
    await userEvent.clear(days)
    await userEvent.type(days, '7')
    await userEvent.clear(cap)
    await userEvent.type(cap, '5.5')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = fetchMock.mock.calls[0]![1]!.body as FormData
    expect(body.get('video_pass_retention_days')).toBe('7')
    expect(body.get('video_storage_cap_mb')).toBe('5632')
  })

  it('refuses a window past a year without sending it', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(withQuery(<VideoStorageCard settings={settings} />))
    const days = screen.getByLabelText("Keep passed flows' videos for (days)")
    await userEvent.clear(days)
    await userEvent.type(days, '400')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('At most 365 days')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('draws nothing for a relay older than flow videos', () => {
    const { container } = render(withQuery(<VideoStorageCard settings={{ team_name: 'Team', logo_url: null }} />))
    expect(container.textContent).toBe('')
  })
})
