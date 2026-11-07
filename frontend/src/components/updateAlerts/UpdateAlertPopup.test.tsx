import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { scheduleLabel, splitInterval } from '@/features/updateAlerts/api'
import { visibleNav } from '@/lib/navigation'
import { AlertPopup, UpdateAlertHost } from './UpdateAlertPopup'

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: { get: vi.fn(), post: vi.fn() },
}))

const get = vi.mocked(api.get)
const post = vi.mocked(api.post)
const alerts = [
  { id: 1, title: 'Server maintenance', message: 'Saturday night.', type: 'warning', published_at: '2026-11-05T01:00:00Z' },
  { id: 2, title: 'New PO flow', message: 'What changed:\n- Quotation page', type: 'feature', published_at: '2026-11-05T01:00:00Z' },
]

describe('UpdateAlertHost', () => {
  beforeEach(() => {
    localStorage.setItem('stockwise_token', 'x')
    let left = [...alerts]
    post.mockImplementation(async (url: string) => {
      left = left.filter((a) => !url.includes(`/${a.id}/`))
      return { data: { data: null } }
    })
    get.mockImplementation(async (url: string) => {
      if (url === '/api/update-alerts/due') return { data: { data: left, meta: { next_in: null } } }
      return { data: { user: { id: 7, name: 'A', roles: [], permissions: [] } } }
    })
  })

  it('shows what is due one at a time and marks each as seen when closed', async () => {
    renderWithProviders(<UpdateAlertHost />)
    expect(await screen.findByRole('alertdialog', { name: 'Server maintenance' })).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Thumbs up' }))
    expect(await screen.findByRole('alertdialog', { name: 'New PO flow' })).toBeInTheDocument()
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    expect(screen.getByText('Quotation page')).toBeInTheDocument()
    expect(post).toHaveBeenCalledWith('/api/update-alerts/1/thumbs-up')

    // closing without the thumb is only a close: it is not on the list of thumbs
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(post).toHaveBeenCalledWith('/api/update-alerts/2/seen')
    expect(post).not.toHaveBeenCalledWith('/api/update-alerts/2/thumbs-up')
  })
})

describe('AlertPopup', () => {
  it('Escape closes the popup, not a form open beneath it', () => {
    const beneath = vi.fn()
    document.addEventListener('keydown', beneath)
    const onClose = vi.fn()
    renderWithProviders(<AlertPopup alert={{ title: 'T', message: 'M', type: 'info' }} onClose={onClose} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(beneath).not.toHaveBeenCalled()
    document.removeEventListener('keydown', beneath)
  })

  it('a preview has nothing to record: the thumb only closes it', () => {
    const onClose = vi.fn()
    renderWithProviders(<AlertPopup alert={{ title: 'T', message: 'M', type: 'info' }} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Thumbs up' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument()
  })

  it('shows the message as text, never as markup', () => {
    renderWithProviders(<AlertPopup alert={{ title: 'T', message: '<img src=x onerror=alert(1)>', type: 'info' }} onClose={() => {}} />)
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })
})

describe('schedule labels', () => {
  it('reads an interval in its largest whole unit', () => {
    expect(splitInterval(90)).toEqual({ value: 90, unit: 1 })
    expect(splitInterval(120)).toEqual({ value: 2, unit: 60 })
    expect(splitInterval(2880)).toEqual({ value: 2, unit: 1440 })
    expect(scheduleLabel({ display_mode: 'interval', interval_minutes: 60 })).toBe('Every hour')
    expect(scheduleLabel({ display_mode: 'interval', interval_minutes: 30 })).toBe('Every 30 minutes')
    expect(scheduleLabel({ display_mode: 'login', interval_minutes: null })).toBe('Every login')
  })
})

describe('the menu', () => {
  const labels = (superAdmin: boolean) => visibleNav(() => true, superAdmin).flatMap((g) => g.items).find((i) => i.label === 'Pengaturan')?.children?.map((c) => c.label)
  it('offers Update Alert to the Super Admin role only, whatever the permissions', () => {
    expect(labels(true)).toContain('Update Alert')
    expect(labels(false)).not.toContain('Update Alert')
  })
})
