import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import type { FlowLine, FlowOpname } from '@/features/opname/workflow'
import { OpnameRoute } from './OpnameRoute'

const line = (o: Partial<FlowLine>): FlowLine => ({
  id: 11, item_id: 1, item_code: 'BRG.001', description: 'Baut M10', uom: 'PCS', location: 'A.1.1', physical_qty: null, note: null,
  count_status: 'PENDING', review_status: 'PENDING', review_note: null, recount_reason: null, count_round: 0, counted_by: null,
  counted_at: null, counts_count: 0, ...o,
})

function doc(o: Partial<FlowOpname> = {}): FlowOpname {
  return {
    id: 5, number: 'SO/GD/26/XI/001', status: 'COUNTING', flow_status: 'COUNTING', from_accurate: false, scope: 'SELECTED', count_method: 'FULL',
    count_round: 1, warehouse: { id: 1, code: 'GUDANG 1', name: 'GUDANG 1' }, location: null, category: null, scheduled_date: '2026-11-18',
    notes: 'Akhir bulan', responsible: { id: 2, name: 'Chindy' }, team: [{ id: 3, name: 'Valen' }], created_by: 'Chindy', created_at: null,
    confirmed_at: null, started_at: null, counter: null, snapshot_at: '2026-11-18T08:00:00+07:00', submitted_at: null, reviewed_at: null, reviewer: null,
    review_note: null, approval_requested_at: null, approved_at: null, approver: null, approval_note: null, posted_at: null, poster: null,
    posting_batch: null, closed_at: null, cancelled_at: null, cancel_reason: null, correction_of: null, corrections: [],
    can_see_system: false, actions: ['count', 'finish_counting'],
    summary: { lines: 2, counted: 0, uncounted: 2, recount: 0, recount_open: 0 },
    lines: [line({}), line({ id: 12, item_id: 2, item_code: 'BRG.002', description: 'Mur M10' })],
    ...o,
  }
}

function mockApi(permissions: string[], data: FlowOpname) {
  vi.spyOn(api, 'get').mockImplementation((url: string) => {
    if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, roles: [], permissions } } }) as never
    if (url.endsWith('/events')) return Promise.resolve({ data: { data: [
      { id: 1, event: 'CREATED', from_status: null, to_status: 'DRAFT', note: null, meta: null, user: 'Chindy', line_id: null, at: '2026-11-18T08:00:00+07:00' },
    ] } }) as never
    return Promise.resolve({ data: { data } }) as never
  })
}

const render = () => renderWithProviders(<Routes><Route path="/stock-opnames/:id" element={<OpnameRoute />} /></Routes>, { route: '/stock-opnames/5' })

describe('OpnameWorkspacePage', () => {
  beforeEach(() => localStorage.setItem('stockwise_token', 't'))
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('blind count: the counter gets inputs, UOM and location, but no system quantity or variance column', async () => {
    mockApi(['opname.view', 'opname.count', 'opname.submit'], doc())
    render()
    expect(await screen.findByRole('heading', { name: 'SO/GD/26/XI/001' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Counted quantity of BRG.001' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'System qty' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Variance' })).not.toBeInTheDocument()
    expect(screen.getAllByText('PCS').length).toBe(2)
    // the status bar shows where it is; only the counting buttons are offered
    expect(within(screen.getByRole('list', { name: 'Workflow' })).getByText('Counting').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: 'Finish Counting' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve & Post' })).not.toBeInTheDocument()
  })

  it('saves a count on leaving the field and a scan finds the line (+1 per scan counts it)', async () => {
    mockApi(['opname.view', 'opname.count'], doc())
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { data: line({ physical_qty: 7, count_status: 'COUNTED', count_round: 1 }) } } as never)
    render()
    const qty = await screen.findByLabelText('Counted quantity of BRG.001')
    await userEvent.type(qty, '7')
    await userEvent.tab()
    expect(post).toHaveBeenCalledWith('/api/stock-opnames/5/lines/11/count', { physical_qty: 7, note: undefined, source: undefined })

    await userEvent.click(screen.getByRole('checkbox', { name: '+1 per scan' }))
    await userEvent.type(screen.getByLabelText('Scan barcode or type item code'), 'brg.002{Enter}')
    expect(post).toHaveBeenLastCalledWith('/api/stock-opnames/5/lines/12/count', { physical_qty: 1, note: undefined, source: 'SCAN' })
    await userEvent.type(screen.getByLabelText('Scan barcode or type item code'), 'XYZ{Enter}')
    expect(await screen.findByRole('status')).toHaveTextContent('"xyz" is not on this stock opname.')
  })

  it('the reviewer sees colored variances, picks items to recount with a reason', async () => {
    const lines = [
      line({ physical_qty: 7, count_status: 'COUNTED', system_qty: 10, variance: -3, variance_pct: -30, variance_kind: 'MINUS', counted_by: 'Valen', counts_count: 1 }),
      line({ id: 12, item_code: 'BRG.002', physical_qty: 5, count_status: 'COUNTED', system_qty: 5, variance: 0, variance_pct: 0, variance_kind: 'MATCH' }),
    ]
    mockApi(['opname.view', 'opname.review', 'opname.request_recount'], doc({ flow_status: 'REVIEW', status: 'REVIEW', can_see_system: true,
      actions: ['review', 'request_approval', 'recount', 'cancel'], lines, summary: { lines: 2, counted: 2, uncounted: 0, recount: 0, recount_open: 0, variance_lines: 1, plus_qty: 0, minus_qty: -3, accuracy: 50 } }))
    const request = vi.spyOn(api, 'request').mockResolvedValue({ data: { data: doc({ flow_status: 'RECOUNT' }) } } as never)
    render()
    expect(await screen.findByRole('columnheader', { name: 'System qty' })).toBeInTheDocument()
    expect(screen.getByText('(−30%)')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Select all variances' }))
    await userEvent.click(screen.getByRole('button', { name: 'Recount (1)' }))
    const dialog = await screen.findByRole('dialog')
    const send = within(dialog).getByRole('button', { name: 'Request Recount' })
    expect(send).toBeDisabled() // a reason is required
    await userEvent.type(within(dialog).getByRole('textbox'), 'selisih besar')
    await userEvent.click(send)
    expect(request).toHaveBeenCalledWith({ url: '/api/stock-opnames/5/recount', method: 'post', data: { line_ids: [11], reason: 'selisih besar' } })
  })

  it('asks before posting and says what will be posted', async () => {
    mockApi(['opname.view', 'opname.approve', 'opname.reject'], doc({ flow_status: 'WAITING_APPROVAL', status: 'WAITING_APPROVAL', can_see_system: true, actions: ['approve', 'reject'],
      lines: [line({ physical_qty: 7, count_status: 'COUNTED', review_status: 'APPROVED', system_qty: 10, variance: -3, variance_kind: 'MINUS' })],
      summary: { lines: 1, counted: 1, uncounted: 0, recount: 0, recount_open: 0, variance_lines: 1, excluded: 0 } }))
    const request = vi.spyOn(api, 'request').mockResolvedValue({ data: { data: doc({ flow_status: 'POSTED' }), meta: { posted: true } } } as never)
    render()
    await userEvent.click(await screen.findByRole('button', { name: 'Approve & Post' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('1 stock adjustments will be posted')
    expect(dialog).toHaveTextContent('if one line fails, nothing is posted')
    expect(request).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve & Post' }))
    expect(request).toHaveBeenCalledWith({ url: '/api/stock-opnames/5/approve', method: 'post', data: { note: undefined } })
  })

  it('a done document is locked and only offers a correction; its history shows the audit trail', async () => {
    mockApi(['opname.view', 'opname.schedule'], doc({ flow_status: 'DONE', status: 'DONE', actions: ['correction'] }))
    render()
    expect(await screen.findByText(/Closed and locked/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Correction' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Counted quantity of BRG.001')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'History & Approval' }))
    expect(await screen.findByText('Chindy · 18 Nov 2026, 08:00', { exact: false })).toBeInTheDocument()
  })

  it('an Accurate mirror keeps the earlier read-only page', async () => {
    vi.spyOn(api, 'get').mockImplementation((url: string) => {
      if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, roles: [], permissions: ['opname.view'] } } }) as never
      if (url.endsWith('/detail')) return Promise.resolve({ data: { data: { ...doc(), from_accurate: true } } }) as never
      return Promise.resolve({ data: { data: { id: 5, number: 'ADJ/1', status: 'PENDING_REVIEW', type: 'PARTIAL', accurate_itemadj_id: 9, items: [] } } }) as never
    })
    render()
    expect(await screen.findByText(/comes from/)).toBeInTheDocument()
  })
})
