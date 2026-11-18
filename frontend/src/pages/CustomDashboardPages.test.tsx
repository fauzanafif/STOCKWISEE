import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { CustomDashboardListPage, CustomDashboardPage } from './CustomDashboardPages'

const dash = {
  id: 5, name: 'Pengadaan', description: 'PR dan PO', icon: 'shopping-cart', visibility: 'PERSONAL', app_key: 'purchase', owner: 'Budi', mine: true, can_edit: true, updated_at: null,
  widgets: [
    { id: 'a', type: 'kpi', source: 'stats.po', title: 'Angka PO', w: 12, h: 1 },
    { id: 'b', type: 'list', source: 'todo.po', title: null, w: 6, h: 2 },
  ],
}

function mockApi(permissions: string[], over: Record<string, unknown> = {}) {
  vi.spyOn(api, 'get').mockImplementation((url: string) => {
    if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, name: 'Budi', roles: ['purchasing'], permissions } } }) as never
    if (url === '/api/custom-dashboards/5') return Promise.resolve({ data: { data: { ...dash, ...over } } }) as never
    if (url === '/api/module-stats/po') return Promise.resolve({ data: { data: { kpis: [{ key: 'open', label: 'Open PO', value: 4 }], trend: { label: 'PO', points: [] }, status: [], top: { label: '', unit: 'qty', rows: [] } } } }) as never
    if (url === '/api/reminders') return Promise.resolve({ data: { data: [{ key: 'r1', modules: ['po'], count: 3, text: 'PO to make', to: '/purchase-orders/siap-po', overdue: 1 }], meta: {} } }) as never
    if (url === '/api/approvals') return Promise.reject({ response: { status: 403 } })
    return Promise.resolve({ data: { data: [] } }) as never
  })
}

const page = () => renderWithProviders(<Routes><Route path="/dashboards/:id" element={<CustomDashboardPage />} /></Routes>, { route: '/dashboards/5' })

describe('Custom dashboards', () => {
  beforeEach(() => localStorage.setItem('stockwise_token', 't'))
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('Add New Dashboard: name, description, icon, visibility, module and widgets of the sources the role may read', async () => {
    mockApi(['po.view', 'ppb.view'])
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { data: { ...dash, id: 9 } } } as never)
    renderWithProviders(<CustomDashboardListPage />, { route: '/dashboards?new=1&app=purchase' })
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Dashboard Name'), 'Pengadaan')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'shopping-cart' }))
    await userEvent.click(within(dialog).getByRole('radio', { name: /Shared/ }))
    // only what the role may read is offered
    const source = within(dialog).getByLabelText('Data source')
    expect(within(source).getByRole('option', { name: 'Purchase Order statistics' })).toBeInTheDocument()
    expect(within(source).queryByRole('option', { name: 'Manufacturing Orders by status' })).not.toBeInTheDocument()
    expect(within(source).queryByRole('option', { name: 'Activity summary (user log)' })).not.toBeInTheDocument()
    await userEvent.selectOptions(source, 'stats.po')
    await userEvent.selectOptions(within(dialog).getByLabelText('Widget'), 'line')
    await userEvent.click(within(dialog).getByRole('button', { name: /Add widget/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create dashboard' }))

    expect(post).toHaveBeenCalledWith('/api/custom-dashboards', expect.objectContaining({
      name: 'Pengadaan', icon: 'shopping-cart', visibility: 'SHARED', app_key: 'purchase',
      widgets: [expect.objectContaining({ source: 'stats.po', type: 'line', w: 6, h: 2 })],
    }))
  })

  it('shows its widgets with their data; edit layout resizes, retitles, removes and saves', async () => {
    mockApi(['po.view'])
    const put = vi.spyOn(api, 'put').mockResolvedValue({ data: { data: dash } } as never)
    page()
    expect(await screen.findByRole('heading', { name: 'Pengadaan' })).toBeInTheDocument()
    expect(await screen.findByText('Open PO')).toBeInTheDocument()
    expect(await screen.findByText('3 PO to make')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Edit layout/ }))
    const kpi = screen.getByRole('region', { name: 'Angka PO' })
    expect(within(kpi).getByRole('button', { name: 'Move Angka PO' })).toBeInTheDocument()
    await userEvent.selectOptions(within(kpi).getByLabelText('Width'), '8')
    const title = within(kpi).getByLabelText('Widget title')
    await userEvent.clear(title)
    await userEvent.type(title, 'PO')
    await userEvent.click(screen.getByRole('button', { name: /Remove To do: Purchase Order/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save layout' }))

    expect(put).toHaveBeenCalledWith('/api/custom-dashboards/5', expect.objectContaining({ widgets: [{ id: 'a', type: 'kpi', source: 'stats.po', title: 'PO', w: 8, h: 1 }] }))
  })

  it('a shared dashboard of someone else opens read only, and a widget out of reach says so', async () => {
    mockApi(['po.view'], { mine: false, can_edit: false, visibility: 'SHARED', widgets: [{ id: 'c', type: 'list', source: 'approvals', title: null, w: 6, h: 2 }] })
    page()
    expect(await screen.findByText('No access to this data')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit layout/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
  })
})
