import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { DashboardPage } from './DashboardPage'

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

describe('DashboardPage', () => {
  beforeEach(() => localStorage.setItem('stockwise_token', 't'))
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('shows the greeting and the To-Do board only, no analytics', async () => {
    mockApi(['item.view'])
    renderWithProviders(<DashboardPage />)

    expect(await screen.findByRole('heading', { level: 1, name: /Budi/ })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Analytics sections' })).not.toBeInTheDocument()
    for (const title of ['Stock Condition', 'Procurement', 'Tracking', 'Stock Card']) {
      expect(screen.queryByRole('heading', { level: 2, name: title })).not.toBeInTheDocument()
    }
  })
})
