import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { DataQualityPage } from './DataQualityPage'

const checks = [
  { key: 'items_without_unit', title: 'Items without a base unit', hint: 'Set it in UOM.', count: 2, columns: ['Code', 'Description'], rows: [{ Code: 'A.1', Description: 'BAUT' }, { Code: 'A.2', Description: 'MUR' }], fix: '/uom' },
  { key: 'similar_departments', title: 'Departments with similar names', hint: 'Keep one.', count: 0, columns: ['Names'], rows: [], fix: '/employees' },
]

describe('DataQualityPage', () => {
  beforeEach(() => localStorage.setItem('stockwise_token', 't'))
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('lists the checks, the open ones first, and opens one to show what to fix', async () => {
    vi.spyOn(api, 'get').mockImplementation((url: string) => {
      if (url === '/api/master-data/quality') return Promise.resolve({ data: { data: checks } }) as never
      if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, name: 'Budi', roles: [], permissions: ['item.view'] } } }) as never
      return Promise.resolve({ data: { data: [] } }) as never
    })
    renderWithProviders(<DataQualityPage />)

    expect(await screen.findByText(/1 of 2 checks need a look/)).toBeInTheDocument()
    expect(screen.getByText('Nothing to fix.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Items without a base unit/ }))
    expect(screen.getByRole('cell', { name: 'A.1' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Fix it there/ })).toHaveAttribute('href', '/uom')
  })
})
