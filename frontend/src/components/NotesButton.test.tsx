import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import { NotesButton } from './NotesButton'

const note = (id: number, title: string, done = false) => ({ id, title, body: null, checklist: [], color: 'yellow', pinned: false, done, done_at: null, remind_at: null, updated_at: null })

describe('NotesButton (sticky notes from any page)', () => {
  beforeEach(() => localStorage.setItem('stockwise_token', 't'))
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

  it('counts the open notes and shows them in a panel', async () => {
    vi.spyOn(api, 'get').mockImplementation((url: string) => {
      if (url === '/api/dashboard-notes') return Promise.resolve({ data: { data: [note(1, 'Telepon vendor'), note(2, 'Cek stok'), note(3, 'Sudah', true)] } }) as never
      if (url === '/api/me') return Promise.resolve({ data: { user: { id: 1, name: 'Budi', roles: [], permissions: [] } } }) as never
      return Promise.resolve({ data: { data: [] } }) as never
    })
    renderWithProviders(<NotesButton />)

    const button = await screen.findByRole('button', { name: 'Sticky notes: 2' })
    await userEvent.click(button)
    expect(screen.getByRole('dialog', { name: 'Sticky notes' })).toBeInTheDocument()
    expect(screen.getByText('Telepon vendor')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Sticky notes' })).not.toBeInTheDocument()
  })

  it('opens the note editor for a new note', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { data: [] } } as never)
    renderWithProviders(<NotesButton />)

    await userEvent.click(await screen.findByRole('button', { name: /Sticky notes/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Note' }))
    expect(await screen.findByText('New note')).toBeInTheDocument()
  })
})
