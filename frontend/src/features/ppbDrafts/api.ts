import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/notify'
import { api } from '@/lib/api'
import type { Paginated } from '@/types/inventory'

/** Draft PPB: the Restock button of Safety Stock makes one; reviewed, edited, then submitted as a PPB. */
export type DraftStatus = 'DRAFT' | 'DIAJUKAN' | 'DIBATALKAN'

export const DRAFT_STATUS: Record<DraftStatus, { label: string; variant: 'warning' | 'success' | 'neutral' }> = {
  DRAFT: { label: 'Draft', variant: 'warning' },
  DIAJUKAN: { label: 'Already a Purchase Request', variant: 'success' },
  DIBATALKAN: { label: 'Cancelled', variant: 'neutral' },
}

export interface PpbDraftRow {
  id: number
  number: string
  status: DraftStatus
  source: string
  no_ppb: string | null
  /** made from a Request Barang (its PPB lines) — else from Restock */
  item_request_id?: number | null
  item_request_number?: string | null
  lines_count: number
  created_by_name: string | null
  created_at: string
}

export interface PpbDraftLine {
  id?: number
  item_id: number | null
  kode_barang: string | null
  deskripsi_barang: string
  qty: number
  satuan: string | null
  catatan: string | null
  basis?: string | null
  available?: number | null
}

export interface PpbDraftDetail extends PpbDraftRow {
  divisi: string | null
  tgl_diperlukan: string | null
  peminta: string | null
  keterangan: string | null
  submitted_at: string | null
  submitted_by_name: string | null
  ppb_id: number | null
  lines: PpbDraftLine[]
}

export function usePpbDrafts(params: { status?: string; page?: number }) {
  return useQuery({
    queryKey: ['ppb-drafts', params],
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<Paginated<PpbDraftRow> & { meta: { open: number } }>('/api/ppb-drafts', { params })).data,
  })
}

/** How many drafts wait for review (the "Draft PPB" button on the PPB page). */
export function useOpenDraftCount(enabled: boolean) {
  return useQuery({
    queryKey: ['ppb-drafts', 'open'],
    enabled,
    queryFn: async () => (await api.get<{ meta: { open: number } }>('/api/ppb-drafts', { params: { per_page: 1 } })).data.meta.open,
  })
}

export function usePpbDraft(id: number) {
  return useQuery({
    queryKey: ['ppb-drafts', id],
    queryFn: async () => (await api.get<{ data: PpbDraftDetail }>(`/api/ppb-drafts/${id}`)).data.data,
  })
}

/** Restock: the picked items (qty = the analysis' suggestion unless given) become a new draft. */
export function useRestock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (items: { item_id: number; qty?: number | null }[]) =>
      (await api.post<{ data: PpbDraftDetail; skipped?: { item_id: number; code: string; reason: string }[] }>('/api/ppb-drafts', { items })).data,
    meta: { successMessage: false },
    onSuccess: (res) => {
      toast.success(`${res.data.lines.length} items in Draft Purchase Request — review before submitting as Purchase Request.`)
      if (res.skipped?.length) toast.info(`Skipped: ${res.skipped.map((x) => `${x.code} ${x.reason}`).join('; ')}`)
      // the analysis shows them "on order" at once (its Restock button locks until the goods arrive)
      return Promise.all([qc.invalidateQueries({ queryKey: ['ppb-drafts'] }), qc.invalidateQueries({ queryKey: ['inventory-analysis'] })])
    },
  })
}

export interface DraftSavePayload {
  divisi?: string | null
  tgl_diperlukan?: string | null
  peminta?: string | null
  keterangan?: string | null
  lines?: Omit<PpbDraftLine, 'basis' | 'available'>[]
}

export function useDraftActions(id: number) {
  const qc = useQueryClient()
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: ['ppb-drafts'] }), qc.invalidateQueries({ queryKey: ['ppb'] })])
  return {
    save: useMutation({
      mutationFn: async (body: DraftSavePayload) => (await api.put<{ data: PpbDraftDetail }>(`/api/ppb-drafts/${id}`, body)).data.data,
      meta: { successMessage: 'Draft saved.' },
      onSuccess: done,
    }),
    submit: useMutation({
      mutationFn: async (body: { no_ppb: string; tgl_ppb: string } & DraftSavePayload) =>
        (await api.post<{ data: PpbDraftDetail }>(`/api/ppb-drafts/${id}/submit`, body)).data.data,
      meta: { successMessage: false },
      onSuccess: (d) => { toast.success(`Submitted as Purchase Request ${d.no_ppb}. Waiting for Purchase Request approval.`); return done() },
    }),
    cancel: useMutation({
      mutationFn: async () => (await api.delete<{ data: PpbDraftDetail }>(`/api/ppb-drafts/${id}`)).data.data,
      meta: { successMessage: 'Draft cancelled.' },
      onSuccess: done,
    }),
  }
}

// ---------------------------------------------------------------- the Draft PPB list (item lines)

/** One item still to buy, and where it comes from: a Request Barang (and its requester) or Safety Stock (Restock). */
export interface DraftLineRow {
  id: number
  item_id: number | null
  kode_barang: string | null
  deskripsi_barang: string
  qty: number
  satuan: string | null
  catatan: string | null
  basis: string | null
  available: number | null
  /** the same item is in the list more than once */
  same_item_lines: number
  source: {
    type: 'REQUEST' | 'RESTOCK'
    draft_id: number
    draft_number: string
    item_request_id: number | null
    item_request_number: string | null
    requester: string | null
    urgency: string | null
    divisi: string | null
    needed_date: string | null
    created_by: string | null
  }
  created_at: string
}

export function useDraftLines(params: { source?: string; search?: string }) {
  return useQuery({
    queryKey: ['ppb-drafts', 'lines', params],
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<{ data: DraftLineRow[]; meta: { total: number; by_source: Partial<Record<'REQUEST' | 'RESTOCK', number>> } }>('/api/ppb-draft-lines', { params })).data,
  })
}

/** Items picked for a Purchase Request, kept before asking for approval. */
export interface SavedDraft {
  id: number
  name: string | null
  no_ppb: string | null
  tgl_ppb: string | null
  tgl_diperlukan: string | null
  divisi: string | null
  keterangan: string | null
  created_by: string | null
  updated_at: string | null
  lines: { id: number; kode_barang: string | null; deskripsi_barang: string; qty: number; satuan: string | null; available: number | null }[]
}

export function useSavedDrafts() {
  return useQuery({
    queryKey: ['ppb-drafts', 'saved'],
    queryFn: async () => (await api.get<{ data: SavedDraft[] }>('/api/ppb-saved-drafts')).data.data,
  })
}

type SavedHeader = { name?: string | null; no_ppb?: string | null; tgl_ppb?: string | null; tgl_diperlukan?: string | null; divisi?: string | null; keterangan?: string | null }

export function useSavedDraftActions() {
  const qc = useQueryClient()
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: ['ppb-drafts'] }), qc.invalidateQueries({ queryKey: ['ppb'] }), qc.invalidateQueries({ queryKey: ['reminders'] })])
  return {
    save: useMutation({
      mutationFn: async (body: SavedHeader & { line_ids: number[] }) => (await api.post('/api/ppb-saved-drafts', body)).data,
      meta: { successMessage: 'Saved as draft.' },
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: SavedHeader & { id: number }) => (await api.put(`/api/ppb-saved-drafts/${id}`, body)).data,
      meta: { successMessage: 'Draft saved.' },
      onSuccess: done,
    }),
    submit: useMutation({
      mutationFn: async ({ id, ...body }: { id: number; no_ppb: string; tgl_ppb: string; divisi?: string | null; tgl_diperlukan?: string | null; keterangan?: string | null }) =>
        (await api.post<{ data: { no_ppb: string; lines: number } }>(`/api/ppb-saved-drafts/${id}/submit`, body)).data.data,
      meta: { successMessage: false },
      onSuccess: (d) => { toast.success(`${d.lines} items submitted as Purchase Request ${d.no_ppb} — waiting for Manager approval.`); return done() },
    }),
    release: useMutation({
      mutationFn: async ({ id, line }: { id: number; line: number }) => (await api.delete(`/api/ppb-saved-drafts/${id}/lines/${line}`)).data,
      meta: { successMessage: 'Item returned to To do.' },
      onSuccess: done,
    }),
    discard: useMutation({
      mutationFn: async (id: number) => (await api.delete(`/api/ppb-saved-drafts/${id}`)).data,
      meta: { successMessage: 'Draft removed; its items returned to To do.' },
      onSuccess: done,
    }),
  }
}

export function useDraftLineActions() {
  const qc = useQueryClient()
  const done = () => Promise.all([qc.invalidateQueries({ queryKey: ['ppb-drafts'] }), qc.invalidateQueries({ queryKey: ['ppb'] }), qc.invalidateQueries({ queryKey: ['item-requests'] })])
  return {
    update: useMutation({
      mutationFn: async ({ id, ...body }: { id: number; qty?: number; catatan?: string | null }) => (await api.put(`/api/ppb-draft-lines/${id}`, body)).data,
      meta: { successMessage: false },
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: async (id: number) => (await api.delete(`/api/ppb-draft-lines/${id}`)).data,
      meta: { successMessage: 'Item removed from Draft Purchase Request.' },
      onSuccess: done,
    }),
    submit: useMutation({
      mutationFn: async (body: { line_ids: number[]; no_ppb: string; tgl_ppb: string; divisi?: string | null; tgl_diperlukan?: string | null; keterangan?: string | null }) =>
        (await api.post<{ data: { no_ppb: string; ppb_id: number | null; lines: number } }>('/api/ppb-draft-lines/submit', body)).data.data,
      meta: { successMessage: false },
      onSuccess: (d) => { toast.success(`${d.lines} items submitted as Purchase Request ${d.no_ppb} — waiting for Manager approval.`); return done() },
    }),
  }
}
