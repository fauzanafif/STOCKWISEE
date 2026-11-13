import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const NOTE_COLORS = ['yellow', 'pink', 'green', 'blue', 'purple', 'orange'] as const
export type NoteColor = (typeof NOTE_COLORS)[number]

export interface ChecklistItem { text: string; done: boolean }

export interface DashboardNote {
  id: number
  title: string | null
  body: string | null
  checklist: ChecklistItem[]
  color: NoteColor
  pinned: boolean
  done: boolean
  done_at: string | null
  remind_at: string | null
  updated_at: string | null
}

export type NoteInput = Partial<Pick<DashboardNote, 'title' | 'body' | 'checklist' | 'color' | 'pinned' | 'done' | 'remind_at'>>

const KEY = ['dashboard-notes']

export function useDashboardNotes() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.get<{ data: DashboardNote[] }>('/api/dashboard-notes')).data.data,
  })
}

export function useDashboardNoteActions() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: KEY })
  return {
    create: useMutation({
      mutationFn: async (body: NoteInput) => (await api.post<{ data: DashboardNote }>('/api/dashboard-notes', body)).data.data,
      meta: { successMessage: 'Note saved.' },
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: NoteInput & { id: number }) => (await api.put<{ data: DashboardNote }>(`/api/dashboard-notes/${id}`, body)).data.data,
      meta: { successMessage: false },
      // the ticked box / pin shows at once; the server answer replaces it
      onMutate: async ({ id, ...body }) => {
        await qc.cancelQueries({ queryKey: KEY })
        const before = qc.getQueryData<DashboardNote[]>(KEY)
        qc.setQueryData<DashboardNote[]>(KEY, (list) => list?.map((n) => (n.id === id ? { ...n, ...body } as DashboardNote : n)))
        return { before }
      },
      onError: (_e, _v, ctx) => { if (ctx?.before) qc.setQueryData(KEY, ctx.before) },
      onSettled: done,
    }),
    remove: useMutation({
      mutationFn: async (id: number) => (await api.delete(`/api/dashboard-notes/${id}`)).data,
      meta: { successMessage: 'Note deleted.' },
      onSuccess: done,
    }),
  }
}
