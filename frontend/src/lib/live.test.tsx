import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useLiveSync } from './live'

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: { get: vi.fn() },
}))

const get = vi.mocked(api.get)
const live = (data: Record<string, string>, enabled: boolean, seconds: number) => ({ data: { data, meta: { refresh: { enabled, seconds } } } })

function Host() {
  useLiveSync(true)
  return null
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const pass = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('useLiveSync', () => {
  beforeEach(() => { vi.useFakeTimers(); get.mockReset() })
  afterEach(() => { vi.useRealTimers() })

  const mount = () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    render(<QueryClientProvider client={client}><Host /></QueryClientProvider>)
    return invalidate
  }

  it('asks again at the interval the server sets', async () => {
    get.mockResolvedValue(live({ request: 'a' }, true, 3) as never)
    mount()
    await flush()
    expect(get).toHaveBeenCalledTimes(1)
    await pass(2900)
    expect(get).toHaveBeenCalledTimes(1)
    await pass(200)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('switched off: slows to a check and refreshes nothing; back on: catches up on what changed', async () => {
    get.mockResolvedValueOnce(live({ request: 'a' }, true, 3) as never)
    get.mockResolvedValueOnce(live({}, false, 3) as never)
    const invalidate = mount()
    await flush()
    await pass(3100) // now off
    expect(get).toHaveBeenCalledTimes(2)
    await pass(59_000)
    expect(get).toHaveBeenCalledTimes(2)
    expect(invalidate).not.toHaveBeenCalled()

    get.mockResolvedValueOnce(live({ request: 'b' }, true, 3) as never)
    await pass(1100)
    expect(get).toHaveBeenCalledTimes(3)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })
})
