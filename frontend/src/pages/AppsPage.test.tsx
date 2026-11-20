import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/auth/AuthProvider'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { AppsPage } from './AppsPage'
import { ComingSoonPage } from './ComingSoonPage'

function mockApi(permissions: string[]) {
  vi.spyOn(api, 'get').mockImplementation((url: string) => {
    if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, name: 'Budi Santoso', roles: ['purchasing'], permissions } } }) as never
    return Promise.resolve({ data: { data: [] } }) as never
  })
}

const launcher = () => screen.findByRole('region', { name: 'Aplikasi' })

describe('AppsPage (App Launcher)', () => {
  beforeEach(() => localStorage.setItem('stockwise_token', 't'))
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('opens each app at its one dashboard, or at its only page', async () => {
    mockApi(['ppb.view', 'po.view', 'item.view', 'maintenance.view', 'important_request.access'])
    renderWithProviders(<AppsPage />)
    const grid = await launcher()

    expect(within(grid).getByRole('link', { name: 'Purchase' })).toHaveAttribute('href', '/purchase')
    expect(within(grid).getByRole('link', { name: 'Inventory' })).toHaveAttribute('href', '/inventory')
    // Maintenance is a menu of Tracking: no app of its own
    expect(within(grid).getByRole('link', { name: 'Tracking' })).toHaveAttribute('href', '/tracking')
    expect(within(grid).queryByRole('link', { name: 'Maintenance' })).not.toBeInTheDocument()
    expect(within(grid).getByRole('link', { name: /^Important Request/ })).toHaveAttribute('href', '/important-requests')
    expect(within(grid).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/todo')
    expect(within(grid).getByRole('link', { name: 'Guide' })).toHaveAttribute('href', '/panduan')
  })

  it('hides the apps the role may not open', async () => {
    mockApi(['item.view'])
    renderWithProviders(<AppsPage />)
    const grid = await launcher()

    for (const name of ['Purchase', 'Employees', 'Approvals', 'Maintenance', 'Settings']) {
      expect(within(grid).queryByRole('link', { name })).not.toBeInTheDocument()
    }
  })

  it('hides the apps without a module (Coming Soon) for now', async () => {
    mockApi(['item.view'])
    renderWithProviders(<AppsPage />)
    const grid = await launcher()

    for (const name of ['Sales', 'Accounting', 'Assets', 'Documents', 'Projects']) {
      expect(within(grid).queryByRole('link', { name: new RegExp(`^${name}`) })).not.toBeInTheDocument()
    }
    expect(within(grid).queryByText('Coming Soon')).not.toBeInTheDocument()
  })

  it('puts every module in an app: nothing is left under "Modul lainnya"', async () => {
    mockApi(['item_request.view', 'npbg.view', 'mrp.view', 'lend.view'])
    renderWithProviders(<AppsPage />)
    const grid = await launcher()

    expect(within(grid).getByRole('link', { name: 'Inventory' })).toHaveAttribute('href', '/inventory')
    expect(within(grid).queryByRole('link', { name: 'Item Request' })).not.toBeInTheDocument()
    expect(within(grid).getByRole('link', { name: 'Manufacturing' })).toHaveAttribute('href', '/mrp')
    expect(within(grid).getByRole('link', { name: 'Tracking' })).toHaveAttribute('href', '/tracking')
    expect(screen.queryByRole('region', { name: 'Modul lainnya' })).not.toBeInTheDocument()
  })

  it('shows the apps in the order the user saved', async () => {
    vi.spyOn(api, 'get').mockImplementation((url: string) => {
      if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, name: 'Budi', roles: ['x'], permissions: ['ppb.view', 'po.view', 'item.view'] } } }) as never
      if (url === '/api/preferences/launcher:order') return Promise.resolve({ data: { data: ['inventory', 'sales', 'purchase'] } }) as never
      return Promise.resolve({ data: { data: [] } }) as never
    })
    renderWithProviders(<AppsPage />)
    const grid = await launcher()
    await waitFor(() => expect(within(grid).getAllByRole('link')[0]).toHaveAccessibleName('Inventory'))
    const names = within(grid).getAllByRole('link').map((l) => l.textContent)
    expect(names[0]).toBe('Inventory')
    expect(names).not.toContain('SalesComing Soon')
  })

  it('every NAV menu belongs to an app', async () => {
    const { NAV } = await import('@/lib/navigation')
    const { launcherApps } = await import('@/lib/launcher')
    expect(launcherApps(NAV, () => true).others.map((i) => i.label)).toEqual([])
  })

  it('filters the apps by the name typed in the navbar search (?q=)', async () => {
    mockApi(['ppb.view', 'po.view', 'item.view'])
    renderWithProviders(<AppsPage />, { route: '/?q=purch' })
    await launcher()

    // Purchase Request now lives in Inventory, so both apps match "purch"
    expect(screen.getByRole('link', { name: 'Purchase' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Inventory' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Manufacturing' })).not.toBeInTheDocument()
  })

  it('says so when no app has the name searched, and clears the search', async () => {
    mockApi(['item.view'])
    renderWithProviders(<AppsPage />, { route: '/?q=zzz' })

    expect(await screen.findByText(/Tidak ada aplikasi bernama/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hapus pencarian' }))
    expect(await screen.findByRole('link', { name: 'Inventory' })).toBeInTheDocument()
  })

  it('greets the user by name, with the icons in one grid (no category titles)', async () => {
    mockApi(['ppb.view', 'po.view', 'item.view'])
    renderWithProviders(<AppsPage />)
    await launcher()

    expect(screen.getByRole('heading', { level: 1, name: /Selamat (pagi|siang|sore|malam), Budi Santoso/ })).toBeInTheDocument()
    expect(screen.queryByText('Operasional')).not.toBeInTheDocument()
    expect(screen.queryByText('Segera Hadir')).not.toBeInTheDocument()
  })
})

describe('ComingSoonPage', () => {
  it('names the app and leads back to the launcher', () => {
    const client = new QueryClient()
    const router = createMemoryRouter([{ path: '/coming-soon/:app', element: <ComingSoonPage /> }], { initialEntries: ['/coming-soon/sales'] })
    render(<QueryClientProvider client={client}><AuthProvider><RouterProvider router={router} /></AuthProvider></QueryClientProvider>)

    expect(screen.getByRole('heading', { level: 1, name: /Sales: Coming Soon/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Kembali ke App Launcher/ })).toHaveAttribute('href', '/')
  })
})
