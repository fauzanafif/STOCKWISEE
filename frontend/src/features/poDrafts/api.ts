import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

/**
 * The PO flow of an item of a STOCKWISE PPB the Direktur approved:
 *   PPB Siap PO (SIAP) → Penawaran Harga (PENAWARAN: purchasing notes each vendor's price, availability, ETA)
 *   → Menunggu Direktur (MENUNGGU_DIREKTUR) → Dipilih Direktur (DIPILIH: one vendor tagged) → Draft PO (one PO = one vendor).
 */
export type PoStage = 'SIAP' | 'PENAWARAN' | 'MENUNGGU_DIREKTUR' | 'DIPILIH' | 'PO'

export interface PoQuote {
  id: number
  vendor_id: number
  vendor_name: string | null
  unit_price: number
  note: string | null
  availability: string | null
  eta: string | null
  by: string | null
  updated_at: string | null
  /** purchasing's last 3 price updates of this vendor, newest first */
  updates: { unit_price: number; at: string | null; by: string | null }[]
  /** the Direktur's pick */
  chosen: boolean
  chosen_by: string | null
  chosen_at: string | null
}

export interface PoPickLog {
  id: number
  action: 'PICK' | 'CHANGE' | 'RETURN'
  from_vendor: string | null
  from_price: number | null
  to_vendor: string | null
  to_price: number | null
  reason: string | null
  by: string | null
  at: string | null
}

export interface PoDraftLine {
  id: number
  item_id: number | null
  item_code: string | null
  description: string
  qty: number
  unit: string | null
  unit_id: number | null
  /** frozen as it was ordered, and the item's Base UOM when it differs */
  unit_ratio?: number | null
  base_unit?: string | null
  stage: PoStage
  /** once it became a PO */
  po: { id: number; number: string | null; status: string | null; vendor_id: number | null } | null
  submitted_at: string | null
  /** why the Direktur sent it back to the Penawaran Harga */
  return_note: string | null
  chosen_quote_id: number | null
  /** the last 3 prices this item was bought at (approved POs), newest first — to compare with the offers */
  price_history: { po: string; date: string | null; vendor: string | null; unit_price: number }[]
  ppb: { id: number; no_ppb: string; divisi: string | null; peminta: string | null; tgl_ppb: string | null; tgl_diperlukan: string | null } | null
  /** cheapest first */
  quotes: PoQuote[]
  /** the vendors chosen for this item: its columns in the Draft PO table, priced or not */
  draft_vendors: { id: number; name: string }[]
  /** every Director pick, change and return, newest first */
  pick_log: PoPickLog[]
}

export function usePoDraftLines(params: { search?: string; stage?: PoStage; done?: 1 }) {
  return useQuery({
    queryKey: ['po-draft-lines', params],
    queryFn: async () => (await api.get<{ data: PoDraftLine[]; meta: { total: number; stages: Partial<Record<PoStage, number>> } }>('/api/po-draft-lines', { params })).data,
  })
}

/** Per line: the units it can be ordered in, each with its size in the item's own unit. */
export function usePoLineUnits(lines: { id: number; item_id: number | null }[]) {
  return useQueries({
    queries: lines.map((l) => ({
      queryKey: ['po-draft-lines', l.id, 'units'],
      enabled: l.item_id != null,
      queryFn: async () => (await api.get<{ data: { base: string | null; units: { unit_id: number; code: string; ratio: number }[] } }>(`/api/po-draft-lines/${l.id}/units`)).data.data,
    })),
  })
}

export function usePoDraftActions() {
  const qc = useQueryClient()
  const done = () => { qc.invalidateQueries({ queryKey: ['po-draft-lines'] }); qc.invalidateQueries({ queryKey: ['reminders'] }); qc.invalidateQueries({ queryKey: ['vendors'] }) }
  const useMove = (path: string, message: string) => useMutation({
    mutationFn: async (line_ids: number[]) => (await api.post<{ data: { moved: number } }>(`/api/po-draft-lines/${path}`, { line_ids })).data.data,
    meta: { successMessage: message },
    onSuccess: done,
  })
  return {
    toQuotation: useMove('to-quotation', 'Items moved to Price Quotation.'),
    toDraftTable: useMutation({
      mutationFn: async (body: { line_ids: number[]; vendor_ids: number[] }) => (await api.post('/api/po-draft-lines/to-quotation', body)).data,
      meta: { successMessage: 'Items and vendors added to Draft PO.' },
      onSuccess: done,
    }),
    addVendors: useMutation({
      mutationFn: async (body: { line_ids: number[]; vendor_ids: number[] }) => (await api.post('/api/po-draft-lines/vendors', body)).data,
      meta: { successMessage: false },
      onSuccess: done,
    }),
    dropVendor: useMutation({
      mutationFn: async ({ vendor, line_ids }: { vendor: number; line_ids: number[] }) => (await api.delete(`/api/po-draft-lines/vendors/${vendor}`, { data: { line_ids } })).data,
      meta: { successMessage: false },
      onSuccess: done,
    }),
    setPrice: useMutation({
      // the note, availability and ETA of the quote go along: the server keeps only what it is sent
      mutationFn: async ({ id, ...body }: { id: number; vendor_id: number; unit_price: number; note?: string | null; availability?: string | null; eta?: string | null }) => (await api.put(`/api/po-draft-lines/${id}/quotes`, body)).data,
      meta: { successMessage: false },
      onSuccess: done,
    }),
    clearPrice: useMutation({
      mutationFn: async ({ id, quoteId }: { id: number; quoteId: number }) => (await api.delete(`/api/po-draft-lines/${id}/quotes/${quoteId}`)).data,
      meta: { successMessage: false },
      onSuccess: done,
    }),
    backToReady: useMove('back-to-ready', 'Item returned to Approved Purchase Request Items.'),
    submitQuotation: useMove('submit-quotation', 'Price Quotation submitted to the Director.'),
    quote: useMutation({
      mutationFn: async ({ id, ...body }: { id: number; vendor_id: number; unit_price: number; note?: string | null; availability?: string | null; eta?: string | null }) =>
        (await api.put<{ data: PoDraftLine }>(`/api/po-draft-lines/${id}/quotes`, body)).data.data,
      meta: { successMessage: 'Vendor price saved.' },
      onSuccess: done,
    }),
    removeQuote: useMutation({
      mutationFn: async ({ id, quoteId }: { id: number; quoteId: number }) =>
        (await api.delete<{ data: PoDraftLine }>(`/api/po-draft-lines/${id}/quotes/${quoteId}`)).data.data,
      onSuccess: done,
    }),
    choose: useMutation({
      mutationFn: async ({ id, quote_id }: { id: number; quote_id: number }) => (await api.post<{ data: PoDraftLine }>(`/api/po-draft-lines/${id}/choose`, { quote_id })).data.data,
      meta: { successMessage: 'Vendor picked.' },
      onSuccess: done,
    }),
    changePick: useMutation({
      mutationFn: async ({ id, quote_id, reason }: { id: number; quote_id: number; reason: string }) => (await api.post<{ data: PoDraftLine }>(`/api/po-draft-lines/${id}/change-pick`, { quote_id, reason })).data.data,
      meta: { successMessage: 'Director pick changed.' },
      onSuccess: done,
    }),
    returnQuotation: useMutation({
      mutationFn: async ({ id, note }: { id: number; note?: string | null }) => (await api.post<{ data: PoDraftLine }>(`/api/po-draft-lines/${id}/return`, { note })).data.data,
      meta: { successMessage: 'Returned to Price Quotation.' },
      onSuccess: done,
    }),
    submit: useMutation({
      mutationFn: async (body: { line_ids: number[]; vendor_id: number; expected_date?: string | null; notes?: string | null; lines: { id: number; qty: number; unit_price: number; unit_id?: number }[] }) =>
        (await api.post<{ data: { id: number; number: string; total: number; lines: number } }>('/api/po-draft-lines/submit', body)).data.data,
      meta: { successMessage: 'Draft PO created and submitted to the Director.' },
      onSuccess: () => { done(); qc.invalidateQueries({ queryKey: ['purchase-orders'] }) },
    }),
    updateItem: useMutation({
      mutationFn: async ({ id, ...body }: { id: number; description?: string; qty?: number; unit_id?: number | null }) =>
        (await api.put<{ data: PoDraftLine }>(`/api/po-draft-lines/${id}`, body)).data.data,
      meta: { successMessage: 'Item updated.' },
      onSuccess: done,
    }),
    removeItem: useMutation({
      mutationFn: async (id: number) => (await api.delete(`/api/po-draft-lines/${id}`)).data,
      meta: { successMessage: 'Item removed from Price Quotation.' },
      onSuccess: done,
    }),
  }
}
