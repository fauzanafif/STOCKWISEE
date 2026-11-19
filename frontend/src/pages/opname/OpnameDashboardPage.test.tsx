import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import type { OpnameDashboard } from '@/features/opname/workflow'
import { OpnameDashboardPage } from './OpnameDashboardPage'

const dash = (o: Partial<OpnameDashboard> = {}): OpnameDashboard => ({
  kpi: { total: 6, draft: 1, counting: 2, review: 1, approval: 1, done: 1, cancelled: 0, variance_lines: 4, accuracy: 87.5 },
  by_status: {}, by_warehouse: [{ id: 1, code: 'GUDANG 1', name: 'GUDANG 1', total: 6, finished: 1, open: 5 }],
  accuracy: [{ month: '2026-11', counted: 8, matched: 7, accuracy: 87.5 }],
  top_variances: [{ line_id: 1, opname_id: 5, number: 'SO/1', flow_status: 'REVIEW', item_code: 'BRG.001', description: 'Baut', system_qty: 10, physical_qty: 4, variance: -6, variance_pct: -60, review_status: 'PENDING' }],
  todo: [{ id: 5, number: 'SO/1', flow_status: 'REVIEW', action: 'Review selisih', warehouse: 'GUDANG 1', scheduled_date: '2026-11-17', items_count: 3, late: false }],
  recent: [{ id: 9, event: 'POSTED', from_status: 'WAITING_APPROVAL', to_status: 'POSTED', note: null, meta: null, user: 'Chindy', line_id: null, at: '2026-11-18T09:00:00+07:00', opname: { id: 4, number: 'SO/0' } }],
  can_see_system: true, ...o,
})

describe('OpnameDashboardPage', () => {
  beforeEach(() => localStorage.setItem('stockwise_token', 't'))
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('shows the KPIs, my to-do, the activity and the largest variances, and filters by status', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation((url: string) => {
      if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, roles: [], permissions: ['opname.view', 'opname.review'] } } }) as never
      if (url === '/api/stock-opnames/dashboard') return Promise.resolve({ data: { data: dash() } }) as never
      return Promise.resolve({ data: { data: { warehouses: [], locations: [], categories: [], users: [] } } }) as never
    })
    renderWithProviders(<OpnameDashboardPage />, { route: '/stock-opnames/dashboard' })

    expect(await screen.findByRole('link', { name: /Waiting Review\s*1/ })).toHaveAttribute('href', '/stock-opnames?view=docs&source=internal&status=REVIEW')
    expect(screen.getByText('87.5%')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Review selisih/ })).toHaveAttribute('href', '/stock-opnames/5')
    expect(screen.getByText('Posted to Stock Ledger')).toBeInTheDocument()
    expect(screen.getByText('(−60%)')).toBeInTheDocument()
    // a counter cannot create an order
    expect(screen.queryByRole('button', { name: /New Stock Opname/ })).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'REVIEW')
    expect(get).toHaveBeenLastCalledWith('/api/stock-opnames/dashboard', { params: { status: 'REVIEW' } })
  })

  it('hides the variance table from someone who only counts (blind count)', async () => {
    vi.spyOn(api, 'get').mockImplementation((url: string) => {
      if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, roles: [], permissions: ['opname.view', 'opname.count'] } } }) as never
      if (url === '/api/stock-opnames/dashboard') return Promise.resolve({ data: { data: dash({ top_variances: null, can_see_system: false }) } }) as never
      return Promise.resolve({ data: { data: { warehouses: [], locations: [], categories: [], users: [] } } }) as never
    })
    renderWithProviders(<OpnameDashboardPage />, { route: '/stock-opnames/dashboard' })
    expect(await screen.findByText('Total Stock Opname')).toBeInTheDocument()
    expect(screen.queryByText('Largest variances')).not.toBeInTheDocument()
  })
})
