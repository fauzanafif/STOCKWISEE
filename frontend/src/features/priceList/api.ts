import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

/** DRAFT / ACTIVE / ARCHIVED are stored; EXPIRED is an ACTIVE price past its Valid Until. */
export type PriceStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'ARCHIVED'

export interface PriceCell {
  id: number
  price: number
  unit: string | null
  min_qty: number
  lead_time_days: number | null
  valid_until: string | null
  status: PriceStatus
  /** how many prices (tiers) this vendor has for the item */
  tiers?: number
  /** the item's base unit changed since the price was kept: save it again with the right unit */
  needs_review?: boolean
}

export interface MatrixRow {
  item: { id: number; code: string; description: string; unit: string | null; category: string | null }
  cells: Record<string, PriceCell>
  lowest_price_id: number | null
  price_count: number
}

export interface PriceMatrix {
  vendors: { id: number; name: string; code: string | null }[]
  rows: MatrixRow[]
  meta: { current_page: number; last_page: number; per_page: number; total: number }
}

export interface PriceRow extends PriceCell {
  item_id: number
  item_code: string | null
  item_name: string | null
  base_unit: string | null
  vendor_id: number
  vendor: string | null
  unit_id: number
  unit_ratio: number
  valid_from: string | null
  stored_status: PriceStatus
  notes: string | null
  updated_at: string | null
  updated_by: string | null
}

export interface PriceHistory {
  id: number
  action: 'CREATE' | 'UPDATE' | 'ARCHIVE' | 'RESTORE'
  old_price: number | null
  new_price: number | null
  old_status: string | null
  new_status: string | null
  changes: Record<string, [unknown, unknown]> | null
  note: string | null
  user: string | null
  at: string | null
}

export interface PriceInput {
  item_id?: number
  vendor_id: number
  unit_id: number
  price: number
  min_qty?: number | null
  lead_time_days?: number | null
  valid_from?: string | null
  valid_until?: string | null
  status: 'DRAFT' | 'ACTIVE'
  notes?: string | null
  change_note?: string | null
}

export interface MatrixFilters { search?: string; category?: string; vendor_ids?: number[]; status?: string; page?: number; per_page?: number }
export interface ListFilters { search?: string; category?: string; vendor_id?: number | ''; status?: string; sort?: string; dir?: 'asc' | 'desc'; page?: number; per_page?: number }

const clean = <T extends object>(f: T) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)))

export function usePriceMatrix(f: MatrixFilters) {
  return useQuery({
    queryKey: ['price-list', 'matrix', f],
    queryFn: async () => (await api.get<{ data: PriceMatrix }>('/api/price-list/matrix', { params: clean(f) })).data.data,
    placeholderData: keepPreviousData,
  })
}

export function usePriceList(f: ListFilters) {
  return useQuery({
    queryKey: ['price-list', 'list', f],
    queryFn: async () => (await api.get<{ data: PriceRow[]; meta: PriceMatrix['meta'] }>('/api/price-list', { params: clean(f) })).data,
    placeholderData: keepPreviousData,
  })
}

export function usePrice(id: number | null) {
  return useQuery({
    queryKey: ['price-list', 'one', id],
    enabled: !!id,
    queryFn: async () => (await api.get<{ data: PriceRow }>(`/api/price-list/${id}`)).data.data,
  })
}

export function usePriceHistory(id: number | null) {
  return useQuery({
    queryKey: ['price-list', 'history', id],
    enabled: !!id,
    queryFn: async () => (await api.get<{ data: PriceHistory[] }>(`/api/price-list/${id}/history`)).data.data,
  })
}

/** the units an item may be bought in, each with its size in the item's own unit */
export function usePurchaseUnits(itemId: number | null) {
  return useQuery({
    queryKey: ['price-list', 'units', itemId],
    enabled: !!itemId,
    staleTime: 5 * 60_000,
    queryFn: async () => (await api.get<{ data: { base: string | null; units: { unit_id: number; code: string; ratio: number }[] } }>(`/api/price-list/items/${itemId}/units`)).data.data,
  })
}

/** For a Purchase Request: the Price List of these items (a reference to check with the vendor). */
export function usePriceReference(itemIds: number[], enabled = true) {
  const ids = [...new Set(itemIds.filter(Boolean))].sort((a, b) => a - b)
  return useQuery({
    queryKey: ['price-list', 'reference', ids],
    enabled: enabled && ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => (await api.get<{ data: Record<string, (PriceCell & { vendor_id: number; vendor: string | null })[]> }>('/api/price-list/reference', { params: { item_ids: ids } })).data.data,
  })
}

export function usePriceActions() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['price-list'] })
  return {
    save: useMutation({
      mutationFn: async ({ id, ...body }: PriceInput & { id?: number }) => (id
        ? await api.put<{ data: PriceRow }>(`/api/price-list/${id}`, body)
        : await api.post<{ data: PriceRow }>('/api/price-list', body)).data.data,
      meta: { successMessage: 'Price saved.' },
      onSuccess: done,
    }),
    archive: useMutation({
      mutationFn: async ({ id, note }: { id: number; note?: string }) => (await api.post<{ data: PriceRow }>(`/api/price-list/${id}/archive`, { note })).data.data,
      meta: { successMessage: 'Price deactivated.' },
      onSuccess: done,
    }),
  }
}

export const rupiah = (n: number | null | undefined) => (n == null ? '—' : `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n)}`)

export const STATUS_LABEL: Record<PriceStatus, string> = { DRAFT: 'Draft', ACTIVE: 'Active', EXPIRED: 'Expired', ARCHIVED: 'Archived' }
export const STATUS_TONE: Record<PriceStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  DRAFT: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  EXPIRED: 'bg-amber-50 text-amber-700 ring-amber-600/25',
  ARCHIVED: 'bg-zinc-100 text-zinc-500 ring-zinc-500/20',
}
