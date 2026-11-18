import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

/** A Draft Price List: items × vendors whose prices are filled, then set in the Master Price List. */
export interface DraftSummary {
  id: number
  number: string
  note: string | null
  status: 'DRAFT' | 'DONE'
  created_by: string | null
  created_at: string | null
  updated_at: string | null
  done_by: string | null
  done_at: string | null
  items_count: number | null
  vendors_count: number | null
  cells_count: number | null
}

export interface DraftItem { id: number; code: string; description: string; unit: string | null }

export interface Draft extends DraftSummary {
  items: DraftItem[]
  vendors: { id: number; name: string; code: string | null }[]
  /** "itemId:vendorId" → price */
  cells: Record<string, number>
}

const KEY = ['price-list', 'drafts']

export function useDrafts(params: { status?: string; search?: string; page?: number }) {
  return useQuery({
    queryKey: [...KEY, 'list', params],
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<{ data: DraftSummary[]; meta: { current_page: number; last_page: number; total: number } }>('/api/price-list/drafts', { params })).data,
  })
}

export function useDraft(id: number) {
  return useQuery({ queryKey: [...KEY, id], queryFn: async () => (await api.get<{ data: Draft }>(`/api/price-list/drafts/${id}`)).data.data })
}

/** Master Items no draft holds yet: what a new draft may take. */
export function useAvailableItems(search: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'available', search],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<{ data: DraftItem[] }>('/api/price-list/drafts/available-items', { params: { search: search || undefined, limit: 50 } })).data.data,
  })
}

export function useDraftActions(id?: number) {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: KEY })
  const put = (d: Draft) => { qc.setQueryData([...KEY, d.id], d); void done() }
  return {
    create: useMutation({
      mutationFn: async (body: { item_ids: number[]; vendor_ids: number[]; note?: string | null }) => (await api.post<{ data: Draft }>('/api/price-list/drafts', body)).data.data,
      meta: { successMessage: 'Draft Price List created.' },
      onSuccess: put,
    }),
    addItems: useMutation({
      mutationFn: async (itemIds: number[]) => (await api.post<{ data: Draft }>(`/api/price-list/drafts/${id}/items`, { item_ids: itemIds })).data.data,
      onSuccess: put,
    }),
    addVendors: useMutation({
      mutationFn: async (vendorIds: number[]) => (await api.post<{ data: Draft }>(`/api/price-list/drafts/${id}/vendors`, { vendor_ids: vendorIds })).data.data,
      onSuccess: put,
    }),
    removeItem: useMutation({
      mutationFn: async (itemId: number) => (await api.delete<{ data: Draft }>(`/api/price-list/drafts/${id}/items/${itemId}`)).data.data,
      onSuccess: put,
    }),
    removeVendor: useMutation({
      mutationFn: async (vendorId: number) => (await api.delete<{ data: Draft }>(`/api/price-list/drafts/${id}/vendors/${vendorId}`)).data.data,
      onSuccess: put,
    }),
    setCell: useMutation({
      mutationFn: async (body: { item_id: number; vendor_id: number; price: number | null }) => (await api.put(`/api/price-list/drafts/${id}/cells`, body)).data,
      onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, id] }),
    }),
    finish: useMutation({
      mutationFn: async () => (await api.post<{ data: Draft }>(`/api/price-list/drafts/${id}/finish`)).data.data,
      meta: { successMessage: 'Prices set in the Master Price List.' },
      onSuccess: (d) => { put(d); void qc.invalidateQueries({ queryKey: ['price-list'] }) },
    }),
    remove: useMutation({
      mutationFn: async () => (await api.delete(`/api/price-list/drafts/${id}`)).data,
      meta: { successMessage: 'Draft deleted.' },
      onSuccess: done,
    }),
  }
}
