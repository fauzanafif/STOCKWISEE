import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { SmartButtons } from './SmartButtons'
import { Chatter } from './Chatter'

const related = {
  document: { type: 'item_request', key: '5', id: 5, number: 'REQ/26/XI/001', label: 'Item Request' },
  groups: [
    { type: 'delivery_order', label: 'Delivery Order', count: 1, docs: [{ type: 'delivery_order', id: 41, number: 'NA/26/XI/007', status: null, date: '2026-11-12', party: 'SITI' }] },
    { type: 'ppb_draft', label: 'Draft Purchase Requests', count: 2, docs: [
      { type: 'ppb_draft', id: 3, number: 'DPR/26/XI/003', status: 'DRAFT', date: '2026-11-12', party: null },
      { type: 'ppb_draft', id: 4, number: 'DPR/26/XI/004', status: 'SUBMITTED', date: '2026-11-11', party: null },
    ] },
  ],
  counts: { messages: 1, activities: 1 },
}

const feed = (staff: boolean) => ({
  data: [
    ...(staff ? [{ id: 'm2', kind: 'NOTE', message_id: 2, at: '2026-11-12T10:00:00+07:00', user_id: 9, user_name: 'ADMIN', body: 'Sisa 6 menunggu PO', deleted: false, edited: false, can_edit: false, attachments: [] }] : []),
    { id: 'm1', kind: 'MESSAGE', message_id: 1, at: '2026-11-12T09:00:00+07:00', user_id: 1, user_name: 'SITI', body: 'Kapan bisa diambil?', deleted: false, edited: false, can_edit: true, attachments: [] },
    { id: 'a1', kind: 'TRACKING', at: '2026-11-12T08:00:00+07:00', user_name: 'DIREKTUR', event: 'UPDATED', model: 'ItemRequest', changes: { status: ['APPROVAL_DIREKTUR', 'DISIAPKAN'] }, reason: null },
  ],
  meta: { staff },
})

const activities = (staff: boolean) => ({
  system: [{ summary: 'Prepare the Delivery Order and hand the items over', responsible: 'Lapangan Gudang', for_you: false, since: null }],
  manual: [], types: { TODO: 'To-Do' }, can_schedule: staff,
})

function mockApi(staff: boolean) {
  return vi.spyOn(api, 'get').mockImplementation((url: string) => {
    if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, roles: [], permissions: [] } } }) as never
    if (url.endsWith('/related')) return Promise.resolve({ data: { data: related } }) as never
    if (url.endsWith('/feed')) return Promise.resolve({ data: feed(staff) }) as never
    if (url.endsWith('/activities')) return Promise.resolve({ data: { data: activities(staff) } }) as never
    return Promise.resolve({ data: { data: [] } }) as never
  })
}

describe('Smart Buttons & Chatter', () => {
  beforeEach(() => localStorage.setItem('stockwise_token', 't'))
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('shows one button per kind of related document with its real count; one opens directly, several list', async () => {
    mockApi(true)
    renderWithProviders(<SmartButtons type="item_request" id={5} />)
    const one = await screen.findByRole('link', { name: /Delivery Order/ })
    expect(one).toHaveAttribute('href', '/npbg/41')
    await userEvent.click(screen.getByRole('button', { name: /2\s*Draft Purchase Requests/ }))
    expect(await screen.findByText('DPR/26/XI/004')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /DPR\/26\/XI\/003/ })).toHaveAttribute('href', '/ppb/drafts/3')
  })

  it('staff see notes, the log note and activity buttons; tracked changes show before → after', async () => {
    mockApi(true)
    renderWithProviders(<Chatter type="item_request" id={5} />)
    expect(await screen.findByText('Sisa 6 menunggu PO')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Note$/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Activity/ })).toBeInTheDocument()
    expect(screen.getByText('APPROVAL_DIREKTUR')).toBeInTheDocument()
    expect(screen.getByText('DISIAPKAN')).toBeInTheDocument()
    expect(screen.getByText('Prepare the Delivery Order and hand the items over')).toBeInTheDocument()
  })

  it('the requester sees messages only: no note button, no scheduling', async () => {
    mockApi(false)
    renderWithProviders(<Chatter type="item_request" id={5} />)
    expect(await screen.findByText('Kapan bisa diambil?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Note$/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Sisa 6 menunggu PO')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Activity$/ })).not.toBeInTheDocument()
  })
})
