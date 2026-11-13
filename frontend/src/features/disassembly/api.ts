import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Paginated } from '@/types/inventory'

/** Disassembly (unbuild): one product taken apart into its BoM components. Every quantity is in the item's Base UOM. */
export type DsaStatus = 'DRAFT' | 'CONFIRMED' | 'IN_PROGRESS' | 'TO_CLOSE' | 'DONE' | 'CANCELLED'
export type DsaKind = 'GOOD' | 'SCRAP' | 'MISSING'
type Variant = 'warning' | 'default' | 'success' | 'neutral' | 'danger'

export const DSA_STATUS: Record<DsaStatus, { label: string; variant: Variant }> = {
  DRAFT: { label: 'Draft', variant: 'neutral' },
  CONFIRMED: { label: 'Confirmed', variant: 'default' },
  IN_PROGRESS: { label: 'In Progress', variant: 'warning' },
  TO_CLOSE: { label: 'To Close', variant: 'warning' },
  DONE: { label: 'Done', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'neutral' },
}

export const DSA_KIND: Record<DsaKind, string> = { GOOD: 'Good result', SCRAP: 'Scrap', MISSING: 'Missing' }

export const DSA_MOVEMENT: Record<string, string> = {
  RESERVATION: 'Reserved', RELEASE_RESERVATION: 'Reservation released',
  DISASSEMBLY_OUT: 'Product taken apart', DISASSEMBLY_IN: 'Component recovered',
  DISASSEMBLY_REVERSE_IN: 'Reversal (product back)', DISASSEMBLY_REVERSE_OUT: 'Reversal (component out)',
}

export const DSA_ACTIVITY: Record<string, string> = {
  CREATED: 'Created', UPDATED: 'Updated', CONFIRMED: 'Confirmed', STARTED: 'Disassembly started', FINISHED: 'Marked as finished',
  REOPENED: 'Reopened', VALIDATED: 'Validated & posted', CANCELLED: 'Cancelled', REVERSED: 'Reversed', ACCURATE_RECORDED: 'Marked as entered in Accurate',
  ENTRY_GOOD: 'Good result recorded', ENTRY_SCRAP: 'Scrap recorded', ENTRY_MISSING: 'Missing recorded', ENTRY_VOIDED: 'Entry voided',
}

export interface Dsa {
  id: number
  number: string
  status: DsaStatus
  item_id: number
  product_code: string | null
  product_name: string | null
  base_unit: string | null
  bom_code: string
  bom_revision: number
  planned_qty: number
  done_qty: number | null
  reserved_qty: number
  source_warehouse_id: number
  source_warehouse: string | null
  responsible_id: number | null
  responsible_name: string | null
  created_at: string | null
  done_at: string | null
  accurate_recorded: boolean
  reversed: boolean
  /** validated before the warehouse-door rule: the order moved stock itself */
  posts_stock: boolean
}

export interface DsaComponent {
  component_id: number
  item_id: number
  code: string | null
  description: string | null
  base_unit: string | null
  qty_per_unit: number
  planned: number
  expected: number
  good: number
  scrap: number
  missing: number
  accounted: number
  open: number
  over: number
  is_extra: boolean
  /** received through the order's Receipts */
  received: number
}

export interface DsaEntry {
  id: number
  kind: DsaKind
  component_id: number
  item_id: number
  item_code: string | null
  item_name: string | null
  qty: number
  unit: string | null
  unit_ratio: number
  base_qty: number
  base_unit: string | null
  entry_date: string | null
  reason: string | null
  note: string | null
  over_plan: boolean
  recorded_by: string | null
  recorded_by_id: number | null
  created_at: string | null
  posted_at: string | null
  voided_at: string | null
  voided_by: string | null
}

export interface DsaMovement {
  id: number; type: string; direction: number; qty: number; item_code: string | null; item_name: string | null; warehouse: string | null
  actual_before: number; actual_after: number; reserved_before: number; reserved_after: number; note: string | null; batch: string | null; user_name: string | null; created_at: string | null
}

type Step = { at: string | null; by: string | null }

export interface DsaDetail extends Dsa {
  notes: string | null
  mrp_bom_id: number
  bom_status: string | null
  bom_changed: boolean
  dest_warehouse_id: number | null
  dest_warehouse: string | null
  created_by_id: number | null
  created_by_name: string | null
  steps: Record<'confirmed' | 'started' | 'finished' | 'done' | 'cancelled' | 'reversed' | 'accurate_recorded', Step>
  cancel_reason: string | null
  accurate_refs: string[]
  source_stock: { stock_known: boolean; on_hand: number; reserved_all: number; held_for_order: number; free: number; available_for_order: number; shortage: number; issued: number; requested: number }
  components: DsaComponent[]
  entries: DsaEntry[]
  movements: DsaMovement[]
  activity: { id: number; action: string; from: string | null; to: string | null; note: string | null; user_name: string | null; at: string | null }[]
  transitions: DsaStatus[]
  gate: import('@/components/WarehouseGatePanel').GateInfo
}

export interface DsaItem { id: number; code: string; description: string; unit: string | null; rounding: number | null; default_warehouse_id: number | null; available: number; active_bom_id: number | null }
export interface DsaBom { id: number; code: string; revision: number; base_unit: string | null; lines: { item_id: number; code: string | null; description: string | null; qty: number; base_unit: string | null }[] }
export interface DsaWarehouseStock { id: number; code: string; name: string; free: number; stock_known: boolean }
export interface DsaDashboard { counts: Record<DsaStatus, number>; total: number; not_in_accurate: number; waiting: Dsa[]; not_in_accurate_list: Dsa[] }
export interface DsaHistoryRow extends Dsa { components: { item_id: number; code: string | null; description: string | null; base_unit: string | null; good: number; scrap: number; missing: number; is_extra: boolean }[] }

const KEY = 'disassembly'

// ------------------------------------------------------------------ queries

export function useDsas(params: { search?: string; status?: string; page?: number; not_in_accurate?: boolean; from?: string; to?: string }) {
  return useQuery({
    queryKey: [KEY, 'orders', params],
    queryFn: async () => (await api.get<Paginated<Dsa>>('/api/disassembly/orders', { params: { ...params, not_in_accurate: params.not_in_accurate ? 1 : undefined } })).data,
    placeholderData: keepPreviousData,
  })
}

export function useDsa(id: number) {
  return useQuery({ queryKey: [KEY, 'orders', id], queryFn: async () => (await api.get<{ data: DsaDetail }>(`/api/disassembly/orders/${id}`)).data.data })
}

export function useDsaDashboard() {
  return useQuery({ queryKey: [KEY, 'dashboard'], queryFn: async () => (await api.get<{ data: DsaDashboard }>('/api/disassembly/dashboard')).data.data })
}

export function useDsaHistory(params: { from?: string; to?: string; item_id?: number | null; search?: string }) {
  return useQuery({
    queryKey: [KEY, 'history', params],
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<{ data: DsaHistoryRow[]; meta: { from: string; to: string; count: number } }>('/api/disassembly/history', { params })).data,
  })
}

export function useDsaItems(q: string) {
  return useQuery({
    queryKey: [KEY, 'items', q],
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<{ data: DsaItem[] }>('/api/disassembly/items', { params: { q } })).data.data,
  })
}

export function useDsaBom(itemId: number | null) {
  return useQuery({ queryKey: [KEY, 'bom', itemId], enabled: !!itemId, queryFn: async () => (await api.get<{ data: DsaBom | null }>(`/api/disassembly/items/${itemId}/bom`)).data.data })
}

export function useDsaStock(itemId: number | null) {
  return useQuery({ queryKey: [KEY, 'stock', itemId], enabled: !!itemId, queryFn: async () => (await api.get<{ data: DsaWarehouseStock[] }>(`/api/disassembly/items/${itemId}/stock`)).data.data })
}

export function useDsaUnits(itemId: number | null) {
  return useQuery({
    queryKey: [KEY, 'units', itemId],
    enabled: !!itemId,
    queryFn: async () => (await api.get<{ data: { unit_id: number; code: string; ratio: number }[] }>(`/api/disassembly/items/${itemId}/units`)).data.data,
  })
}

export function useDsaWarehouses(enabled = true) {
  return useQuery({ queryKey: [KEY, 'warehouses'], enabled, queryFn: async () => (await api.get<{ data: { id: number; code: string; name: string }[] }>('/api/disassembly/warehouses')).data.data })
}

export function useDsaUsers(enabled = true) {
  return useQuery({ queryKey: [KEY, 'users'], enabled, queryFn: async () => (await api.get<{ data: { id: number; name: string }[] }>('/api/disassembly/users')).data.data })
}

// ------------------------------------------------------------------ mutations

export interface DsaPayload { item_id?: number; planned_qty?: string; source_warehouse_id?: number; dest_warehouse_id?: number | null; responsible_id?: number | null; notes?: string | null }

export function useSaveDsa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id?: number; data: DsaPayload }) =>
      (id ? await api.put<{ data: DsaDetail }>(`/api/disassembly/orders/${id}`, data) : await api.post<{ data: DsaDetail }>('/api/disassembly/orders', data)).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export interface DsaEntryPayload { kind: DsaKind; item_id: number; qty: string; unit?: string | null; entry_date?: string | null; reason?: string | null; note?: string | null; client_key: string }

export function useDsaStep(id: number) {
  const qc = useQueryClient()
  const onSuccess = (data: DsaDetail) => { qc.setQueryData([KEY, 'orders', id], data); void qc.invalidateQueries({ queryKey: [KEY] }) }
  const post = async (path: string, body?: Record<string, unknown>) => (await api.post<{ data: DsaDetail }>(`/api/disassembly/orders/${id}/${path}`, body ?? {})).data.data
  return {
    confirm: useMutation({ mutationFn: () => post('confirm'), onSuccess }),
    start: useMutation({ mutationFn: () => post('start'), onSuccess }),
    finish: useMutation({ mutationFn: (doneQty: string) => post('finish', { done_qty: doneQty }), onSuccess }),
    reopen: useMutation({ mutationFn: (note?: string | null) => post('reopen', { note }), onSuccess }),
    validate: useMutation({ mutationFn: () => post('validate'), onSuccess }),
    cancel: useMutation({ mutationFn: (reason?: string | null) => post('cancel', { reason }), onSuccess }),
    reverse: useMutation({ mutationFn: (reason: string) => post('reverse', { reason }), onSuccess }),
    accurate: useMutation({ mutationFn: (refs: string[]) => post('accurate', { refs }), onSuccess }),
    requestProduct: useMutation({
      mutationFn: async () => (await api.post<{ data: { id: number; number: string } }>(`/api/disassembly/orders/${id}/request-product`)).data.data,
      onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
    }),
    linkReceipt: useMutation({ mutationFn: async (noRi: string) => (await api.post<{ data: DsaDetail }>(`/api/disassembly/orders/${id}/receipts`, { no_ri: noRi })).data.data, onSuccess }),
    unlinkReceipt: useMutation({ mutationFn: async (noRi: string) => (await api.delete<{ data: DsaDetail }>(`/api/disassembly/orders/${id}/receipts`, { data: { no_ri: noRi } })).data.data, onSuccess }),
    addEntry: useMutation({ mutationFn: (data: DsaEntryPayload) => post('entries', data as unknown as Record<string, unknown>), onSuccess }),
    voidEntry: useMutation({
      mutationFn: async (entryId: number) => (await api.delete<{ data: DsaDetail }>(`/api/disassembly/orders/${id}/entries/${entryId}`)).data.data,
      onSuccess,
    }),
  }
}
