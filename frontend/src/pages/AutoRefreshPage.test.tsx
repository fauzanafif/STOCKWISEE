import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { AutoRefreshPage } from './AutoRefreshPage'

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: { get: vi.fn(), put: vi.fn() },
}))

const get = vi.mocked(api.get)
const put = vi.mocked(api.put)

describe('AutoRefreshPage', () => {
  beforeEach(() => {
    put.mockReset()
    get.mockResolvedValue({ data: { data: { enabled: true, seconds: 15 } } } as never)
    put.mockImplementation(async (_url, body) => ({ data: { data: body } }) as never)
  })

  it('saves a preset', async () => {
    renderWithProviders(<AutoRefreshPage />)
    fireEvent.click(await screen.findByRole('button', { name: '3 sec' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/settings/auto-refresh', { enabled: true, seconds: 3 }))
  })

  it('saves a custom interval and refuses one below the limit', async () => {
    renderWithProviders(<AutoRefreshPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText('Seconds'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Fill in 3 to 600 seconds.')).toBeInTheDocument()
    expect(put).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Seconds'), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/settings/auto-refresh', { enabled: true, seconds: 45 }))
  })

  it('switches it off', async () => {
    renderWithProviders(<AutoRefreshPage />)
    fireEvent.click(await screen.findByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/settings/auto-refresh', { enabled: false, seconds: 15 }))
  })
})
