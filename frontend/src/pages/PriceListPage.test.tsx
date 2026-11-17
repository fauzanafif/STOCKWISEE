import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { PriceListPage } from './PriceListPage'

const cell = (id: number, price: number, status = 'ACTIVE', extra = {}) => ({ id, price, unit: 'PCS', min_qty: 1, lead_time_days: 3, valid_until: null, status, tiers: 1, ...extra })

const matrix = {
  vendors: [{ id: 1, name: 'PT Vendor A', code: null }, { id: 2, name: 'PT Vendor B', code: null }],
  rows: [
    { item: { id: 10, code: 'BRG.6204', description: 'BEARING 6204', unit: 'PCS', category: null }, cells: { 1: cell(100, 25000), 2: cell(101, 23500) }, lowest_price_id: 101, price_count: 2 },
    { item: { id: 11, code: 'REG.GAS', description: 'REGULATOR GAS', unit: 'PCS', category: null }, cells: { 2: cell(102, 85000, 'EXPIRED') }, lowest_price_id: null, price_count: 1 },
    { item: { id: 12, code: 'KBL.NYA', description: 'KABEL NYA', unit: 'MTR', category: null }, cells: {}, lowest_price_id: null, price_count: 0 },
  ],
  meta: { current_page: 1, last_page: 1, per_page: 25, total: 3 },
}

const row = { ...cell(100, 25000), item_id: 10, item_code: 'BRG.6204', item_name: 'BEARING 6204', base_unit: 'PCS', vendor_id: 1, vendor: 'PT Vendor A', unit_id: 5, unit_ratio: 1, valid_from: null, stored_status: 'ACTIVE', notes: null, updated_at: '2026-11-16T08:00:00+07:00', updated_by: 'Budi' }

function mockApi(permissions = ['rfq.view', 'rfq.create', 'rfq.update', 'master.vendor.view', 'item.view']) {
  return vi.spyOn(api, 'get').mockImplementation((url: string) => {
    if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, name: 'Budi', roles: ['purchasing'], permissions } } }) as never
    if (url === '/api/price-list/matrix') return Promise.resolve({ data: { data: matrix } }) as never
    if (url === '/api/price-list') return Promise.resolve({ data: { data: [row], meta: { current_page: 1, last_page: 1, per_page: 25, total: 1 } } }) as never
    if (url === '/api/price-list/100') return Promise.resolve({ data: { data: row } }) as never
    if (url === '/api/price-list/100/history') return Promise.resolve({ data: { data: [
      { id: 2, action: 'UPDATE', old_price: 24000, new_price: 25000, old_status: 'ACTIVE', new_status: 'ACTIVE', changes: null, note: 'Harga naik', user: 'Budi', at: '2026-11-16T08:00:00+07:00' },
      { id: 1, action: 'CREATE', old_price: null, new_price: 24000, old_status: null, new_status: 'ACTIVE', changes: null, note: null, user: 'Budi', at: '2026-11-01T08:00:00+07:00' },
    ] } }) as never
    if (url === '/api/price-list/items/10/units') return Promise.resolve({ data: { data: { base: 'PCS', units: [{ unit_id: 5, code: 'PCS', ratio: 1 }] } } }) as never
    if (url === '/api/vendors') return Promise.resolve({ data: { data: [{ id: 1, name: 'PT Vendor A', is_active: true }, { id: 2, name: 'PT Vendor B', is_active: true }] } }) as never
    return Promise.resolve({ data: { data: [] } }) as never
  })
}

describe('PriceListPage', () => {
  beforeEach(() => localStorage.setItem('stockwise_token', 't'))
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('shows the Item × Vendor matrix: prices, the lowest, expired, and items without a price', async () => {
    mockApi()
    renderWithProviders(<PriceListPage />)

    expect(await screen.findByRole('columnheader', { name: 'PT Vendor A' })).toBeInTheDocument()
    const bearing = screen.getByText('BRG.6204').closest('tr')!
    expect(within(bearing).getByText('Rp25.000')).toBeInTheDocument()
    expect(within(bearing).getByText(/Lowest/)).toBeInTheDocument()
    expect(within(screen.getByText('REG.GAS').closest('tr')!).getByText(/Expired/)).toBeInTheDocument()
    const kabel = screen.getByText('KBL.NYA').closest('tr')!
    expect(within(kabel).getByText('No price yet')).toBeInTheDocument()
    expect(within(kabel).getAllByRole('button', { name: 'Add price' })).toHaveLength(2)
  })

  it('opens a price with its detail and its history', async () => {
    mockApi()
    renderWithProviders(<PriceListPage />)

    await userEvent.click(await screen.findByText('Rp25.000'))
    expect(await screen.findByRole('heading', { name: 'BRG.6204 · PT Vendor A' })).toBeInTheDocument()
    expect(await screen.findByDisplayValue('25000')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Price History/ }))
    expect(await screen.findByText('“Harga naik”')).toBeInTheDocument()
    // 24.000 → 25.000, and the first price 24.000
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByText('Rp24.000')).toHaveLength(2)
    expect(within(dialog).getByText('Rp25.000')).toBeInTheDocument()
  })

  it('switches to the List view and remembers it', async () => {
    mockApi()
    renderWithProviders(<PriceListPage />)

    await userEvent.click(await screen.findByRole('tab', { name: /List/ }))
    expect(await screen.findByRole('columnheader', { name: /Vendor Price/ })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'PT Vendor A' })).toBeInTheDocument()
    expect(localStorage.getItem('sw.priceList.view')).toBe('list')
  })

  it('a reader without rfq.create cannot add prices', async () => {
    mockApi(['rfq.view', 'master.vendor.view', 'item.view'])
    renderWithProviders(<PriceListPage />)

    await screen.findByText('BRG.6204')
    expect(screen.queryByRole('button', { name: /Add Price/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add price' })).not.toBeInTheDocument()
  })
})
