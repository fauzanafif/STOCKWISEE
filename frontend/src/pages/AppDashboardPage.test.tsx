import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { AppDashboardPage } from './AppDashboardPage'

// the parts come from the module dashboards and the old Analytics page, tested on their own
vi.mock('@/components/dashboard/ProcurementDashboard', () => ({ ProcurementDashboard: () => <div>chart:procurement</div> }))
vi.mock('@/components/dashboard/OperationsDashboard', () => ({ TrackingDashboard: () => <div>chart:tracking</div> }))

function mockApi(permissions: string[]) {
  vi.spyOn(api, 'get').mockImplementation((url: string) => {
    if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, name: 'Budi', roles: ['admin_gudang'], permissions } } }) as never
    return Promise.resolve({ data: { data: [] } }) as never
  })
}

describe('AppDashboardPage', () => {
  beforeEach(() => localStorage.setItem('stockwise_token', 't'))
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('shows one simple card per feature, in the order of the menu bar, each with one button', async () => {
    mockApi(['item_request.view', 'npbg.view', 'item.view'])
    renderWithProviders(<AppDashboardPage appKey="inventory" />, { route: '/inventory' })

    const menu = await screen.findByRole('navigation', { name: 'Menu Inventory' })
    const cards = within(menu).getAllByRole('article')
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Item Request', 'Delivery Order', 'Barang', 'Jasa', 'Kartu Stok', 'Data Quality'])
    const dO = within(menu).getByRole('article', { name: 'Delivery Order' })
    expect(within(dO).getAllByRole('link').map((l) => l.textContent)).toEqual(['Delivery Order', 'Open'])
    expect(within(dO).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/npbg')
    // nothing else on the overview: no search, no to-do lists
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByText('todo:request')).not.toBeInTheDocument()
  })

  it('gives an operation card Odoo-style bars by date and its late count', async () => {
    vi.spyOn(api, 'get').mockImplementation((url: string) => {
      if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, name: 'Budi', roles: ['admin_gudang'], permissions: ['item_request.view', 'item.view'] } } }) as never
      if (url === '/api/reminders') return Promise.resolve({ data: { data: [
        { key: 'r1', modules: ['request'], count: 4, overdue: 2, urgent: 0, soon: 0, items: [], graph: { before: 2, yesterday: 0, today: 1, tomorrow: 1, after: 0 } },
      ], meta: {} } }) as never
      return Promise.resolve({ data: { data: [] } }) as never
    })
    renderWithProviders(<AppDashboardPage appKey="inventory" />, { route: '/inventory' })

    const card = await screen.findByRole('article', { name: 'Item Request' })
    expect(await within(card).findByRole('link', { name: '4 To Process' })).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: '2 Late' })).toBeInTheDocument()
    expect(within(card).getByRole('img', { name: 'Before: 2, Yesterday: 0, Today: 1, Tomorrow: 1, After: 0' })).toBeInTheDocument()
    // a page without a module of its own keeps the plain card
    expect(within(await screen.findByRole('article', { name: 'Barang' })).queryByRole('img')).not.toBeInTheDocument()
  })

  it('sticks draggable notes on a card: an open one floats on the board, the card button sticks a new one', async () => {
    const note = { id: 7, anchor: 'inventory:/npbg', layout: { x: 10, y: 20, w: 240, h: 190, open: true }, title: 'Cek DO', body: 'gudang 2',
      checklist: [], color: 'yellow', pinned: false, done: false, done_at: null, remind_at: null, updated_at: null }
    vi.spyOn(api, 'get').mockImplementation((url: string) => {
      if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, name: 'Budi', roles: ['admin_gudang'], permissions: ['npbg.view', 'item.view'] } } }) as never
      if (url === '/api/dashboard-notes') return Promise.resolve({ data: { data: [note], meta: { card_notes: true } } }) as never
      return Promise.resolve({ data: { data: [] } }) as never
    })
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { data: { ...note, id: 8 } } } as never)
    const put = vi.spyOn(api, 'put').mockResolvedValue({ data: { data: note } } as never)
    renderWithProviders(<AppDashboardPage appKey="inventory" />, { route: '/inventory' })

    const floating = await screen.findByRole('dialog', { name: 'Note on Delivery Order' })
    expect(floating).toHaveStyle({ left: '10px', top: '20px', width: '240px' })
    expect(within(floating).getByRole('textbox', { name: 'Note' })).toHaveValue('gudang 2')
    expect(screen.getByRole('button', { name: 'Notes on Delivery Order: 1' })).toBeInTheDocument()

    // the keyboard moves it (and saves where it is)
    within(floating).getByRole('toolbar').focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(put).toHaveBeenCalledWith('/api/dashboard-notes/7', { layout: expect.objectContaining({ x: 26, y: 20, open: true }) })

    // folded away
    await userEvent.click(within(floating).getByRole('button', { name: /Fold away/ }))
    expect(put).toHaveBeenLastCalledWith('/api/dashboard-notes/7', { layout: expect.objectContaining({ open: false }) })

    // a card without notes: its button sticks a new one on it
    await userEvent.click(screen.getByRole('button', { name: 'Add a note to Barang' }))
    expect(post).toHaveBeenCalledWith('/api/dashboard-notes', expect.objectContaining({ anchor: 'inventory:/items?kind=BARANG', layout: expect.objectContaining({ open: true }) }))
  })

  it('shows no note buttons while the server cannot stick notes on cards', async () => {
    mockApi(['npbg.view'])
    renderWithProviders(<AppDashboardPage appKey="inventory" />, { route: '/inventory' })
    await screen.findByRole('article', { name: 'Delivery Order' })
    expect(screen.queryByRole('button', { name: /note/i })).not.toBeInTheDocument()
  })

  it('has no To do view any more: ?tab=todo opens the overview', async () => {
    mockApi(['item_request.view', 'item.view'])
    renderWithProviders(<AppDashboardPage appKey="inventory" />, { route: '/inventory?tab=todo' })
    expect(await screen.findByRole('navigation', { name: 'Menu Inventory' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'To do' })).not.toBeInTheDocument()
  })

  it('shows the analysis of the app on its own tab (Purchase); Inventory has none, it is on Dashboard › Analytics', async () => {
    mockApi(['po.view'])
    renderWithProviders(<AppDashboardPage appKey="purchase" />, { route: '/purchase' })
    await userEvent.click(await screen.findByRole('tab', { name: 'Analysis' }))
    expect(screen.getByText('chart:procurement')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument()
  })

  it('Inventory has no Analysis view', async () => {
    mockApi(['item.view'])
    renderWithProviders(<AppDashboardPage appKey="inventory" />, { route: '/inventory?tab=analysis' })
    expect(await screen.findByRole('navigation', { name: 'Menu Inventory' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Analysis' })).not.toBeInTheDocument()
  })

  it('puts Manufacturing Orders and Disassembly on one overview', async () => {
    mockApi(['mrp.view', 'disassembly.view'])
    renderWithProviders(<AppDashboardPage appKey="manufacturing" />, { route: '/mrp' })
    expect(await screen.findByRole('article', { name: 'Manufacturing Orders' })).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Disassembly Orders' })).toBeInTheDocument()
  })

  it('says so when the role may open nothing of the app', async () => {
    mockApi(['item.view'])
    renderWithProviders(<AppDashboardPage appKey="purchase" />, { route: '/purchase' })
    expect(await screen.findByText('You have no access to this app')).toBeInTheDocument()
  })

})
