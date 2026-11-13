import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { AnalyticsPage } from './AnalyticsPage'

const summary = {
  cards: [
    { key: 'safe', label: 'Status AMAN', value: 8912, tone: 'success' },
    { key: 'po_open', label: 'Running POs', value: 81, tone: 'default' },
  ],
  charts: { po_status: [{ name: 'RECEIVED', value: 1222 }] },
  lists: {},
}

function mockApi(permissions: string[]) {
  vi.spyOn(api, 'get').mockImplementation((url: string) => {
    if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, name: 'Budi Santoso', roles: ['admin'], permissions } } }) as never
    if (url === '/api/dashboard') return Promise.resolve({ data: { data: summary } }) as never
    // each analysis has its own endpoint; their data is not under test here
    if (url.startsWith('/api/dashboard/')) return Promise.reject(new Error('not under test')) as never
    return Promise.resolve({ data: { data: [] } }) as never
  })
}

describe('AnalyticsPage', () => {
  beforeEach(() => {
    localStorage.setItem('stockwise_token', 't')
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('shows every analysis on one page, with a bar to jump between the sections', async () => {
    mockApi(['item.view'])
    renderWithProviders(<AnalyticsPage />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument()
    for (const title of ['Stock Condition', 'Procurement', 'Tracking', 'Stock Card']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
    }
    const nav = screen.getByRole('navigation', { name: 'Analytics sections' })
    fireEvent.click(within(nav).getByRole('button', { name: 'Procurement' }))
    expect(within(nav).getByRole('button', { name: 'Procurement' })).toHaveAttribute('aria-current', 'true')
    // jumping scrolls; every other section stays on the page
    expect(screen.getByRole('heading', { level: 2, name: 'Stock Condition' })).toBeInTheDocument()
  })

  it('has no to-do board, quick access or key figures', async () => {
    mockApi([])
    renderWithProviders(<AnalyticsPage />)

    expect(await screen.findByRole('heading', { level: 2, name: 'Stock Condition' })).toBeInTheDocument()
    for (const gone of ['Quick access', 'Key figures', 'Running POs', 'Status AMAN', 'My Notes']) expect(screen.queryByText(gone)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Stock Card' })).not.toBeInTheDocument()
  })
})
