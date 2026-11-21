import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { AnalyticsBody } from './AnalyticsPage'

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

describe('AnalyticsBody (part of the one Dashboard)', () => {
  beforeEach(() => {
    localStorage.setItem('stockwise_token', 't')
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it("shows every analysis under All, and only the chosen app's under its button", async () => {
    mockApi(['item.view'])
    const { unmount } = renderWithProviders(<AnalyticsBody module="all" />)
    for (const title of ['Stock Condition', 'Procurement', 'Tracking', 'Stock Card']) {
      expect(await screen.findByRole('heading', { level: 3, name: title })).toBeInTheDocument()
    }
    unmount()
    renderWithProviders(<AnalyticsBody module="purchase" />)
    expect(await screen.findByRole('heading', { level: 3, name: 'Procurement' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Stock Condition' })).not.toBeInTheDocument()
  })

  it('has no Stock Card without the right to see items', async () => {
    mockApi([])
    renderWithProviders(<AnalyticsBody module="all" />)
    expect(await screen.findByRole('heading', { level: 3, name: 'Stock Condition' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Stock Card' })).not.toBeInTheDocument()
  })
})
