import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { PriceListDraftListPage, PriceListDraftPage } from './PriceListDraftPages'

const draft = {
  id: 7, number: 'PL/26/XI/001', note: 'Q4', status: 'DRAFT', created_by: 'Budi', created_at: null, updated_at: '2026-11-17T08:00:00Z', done_by: null, done_at: null,
  items_count: 2, vendors_count: 2, cells_count: 1,
  items: [{ id: 1, code: 'BRG.1', description: 'Bearing', unit: 'PCS' }, { id: 2, code: 'KBL.1', description: 'Kabel', unit: 'MTR' }],
  vendors: [{ id: 10, name: 'Sinar', code: null }, { id: 11, name: 'Jaya', code: null }],
  cells: { '1:10': 25000 },
}

function mockApi(permissions: string[]) {
  vi.spyOn(api, 'get').mockImplementation((url: string) => {
    if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, name: 'Budi', roles: ['purchasing'], permissions } } }) as never
    if (url === '/api/price-list/drafts/7') return Promise.resolve({ data: { data: draft } }) as never
    if (url === '/api/vendors') return Promise.resolve({ data: { data: [{ id: 10, name: 'Sinar', code: 'V-01' }, { id: 11, name: 'Jaya', code: null }] } }) as never
    if (url === '/api/price-list/drafts/available-items') return Promise.resolve({ data: { data: [{ id: 1, code: 'BRG.1', description: 'Bearing', unit: 'PCS' }] } }) as never
    return Promise.resolve({ data: { data: [] } }) as never
  })
}

const page = () => renderWithProviders(<Routes><Route path="/price-list/drafts/:id" element={<PriceListDraftPage />} /></Routes>, { route: '/price-list/drafts/7' })

describe('PriceListDraftPage', () => {
  beforeEach(() => localStorage.setItem('stockwise_token', 't'))
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('is a matrix of the items × vendors picked; an empty crossing reads "–", a typed price is saved', async () => {
    mockApi(['rfq.view', 'rfq.create'])
    const put = vi.spyOn(api, 'put').mockResolvedValue({ data: { data: { ok: true } } } as never)
    page()
    expect(await screen.findByRole('heading', { name: 'PL/26/XI/001' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Sinar/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Price Sinar for Bearing' })).toHaveValue('25000')
    const empty = screen.getByRole('textbox', { name: 'Price Jaya for Kabel' })
    expect(empty).toHaveAttribute('placeholder', '–')

    await userEvent.type(empty, '4500')
    await userEvent.tab()
    expect(put).toHaveBeenCalledWith('/api/price-list/drafts/7/cells', { item_id: 2, vendor_id: 11, price: 4500 })
    expect(screen.getByRole('button', { name: /Set Harga/ })).toBeEnabled()
  })

  it('is read only once its prices are set', async () => {
    mockApi(['rfq.view', 'rfq.create'])
    draft.status = 'DONE'
    page()
    const table = await screen.findByRole('table')
    expect(within(table).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(table).getByText('Rp 25.000')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Set Harga/ })).not.toBeInTheDocument()
    draft.status = 'DRAFT'
  })


  it('New Draft: two buttons on top, Items and Vendors, each a list to tick', async () => {
    mockApi(['rfq.view', 'rfq.create'])
    renderWithProviders(<PriceListDraftListPage />)
    await userEvent.click(await screen.findByRole('button', { name: /New Draft/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('tab', { name: /Items/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Bearing/ }))

    await userEvent.click(within(dialog).getByRole('tab', { name: /Vendors/ }))
    const sinar = await within(dialog).findByRole('checkbox', { name: /Sinar/ })
    expect(within(dialog).getByRole('checkbox', { name: /Jaya/ })).not.toBeChecked()
    await userEvent.click(sinar)
    expect(sinar).toBeChecked()
    expect(within(dialog).getByRole('tab', { name: /Vendorss*1/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Create draft' })).toBeEnabled()
  })
})
