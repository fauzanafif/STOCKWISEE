import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { AppDashboardPage } from './AppDashboardPage'

// the parts come from the module dashboards and the old Analytics page, tested on their own
vi.mock('@/pages/ModuleDashboardPage', () => ({ ModuleDashboardBody: ({ module }: { module: string }) => <div>todo:{module}</div> }))
vi.mock('@/pages/mrp/MrpDashboardPage', () => ({ MrpDashboardBody: () => <div>todo:mrp</div> }))
vi.mock('@/pages/disassembly/DisassemblyDashboardPage', () => ({ DisassemblyDashboardBody: () => <div>todo:disassembly</div> }))
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

  it('lists the to-do of each module the role may open in the To do view', async () => {
    mockApi(['item_request.view', 'item.view'])
    renderWithProviders(<AppDashboardPage appKey="inventory" />, { route: '/inventory?tab=todo' })
    expect(await screen.findByText('todo:request')).toBeInTheDocument()
    // no ri.view: no Receipt to-do
    expect(screen.queryByText('todo:ri')).not.toBeInTheDocument()
  })

  it('shows the analysis of the app on its own tab (Purchase); Inventory has none, it is on Dashboard › Analytics', async () => {
    mockApi(['ppb.view'])
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

  it('puts Manufacturing Orders and Disassembly on one dashboard', async () => {
    mockApi(['mrp.view', 'disassembly.view'])
    renderWithProviders(<AppDashboardPage appKey="manufacturing" />, { route: '/mrp?tab=todo' })
    expect(await screen.findByText('todo:mrp')).toBeInTheDocument()
    expect(screen.getByText('todo:disassembly')).toBeInTheDocument()
  })

  it('says so when the role may open nothing of the app', async () => {
    mockApi(['item.view'])
    renderWithProviders(<AppDashboardPage appKey="purchase" />, { route: '/purchase' })
    expect(await screen.findByText('You have no access to this app')).toBeInTheDocument()
  })

})
