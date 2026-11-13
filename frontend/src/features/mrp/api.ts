import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Paginated } from '@/types/inventory'

/** Manufacturing: Bills of Materials and Manufacturing Orders. Every quantity is in the item's Base UOM. */
export type BomStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
export type MoStatus = 'DRAFT' | 'CONFIRMED' | 'IN_PROGRESS' | 'TO_CLOSE' | 'DONE' | 'CANCELLED'
export type EntryKind = 'CONSUME' | 'OUTPUT' | 'SCRAP'
type Variant = 'warning' | 'default' | 'success' | 'neutral' | 'danger'

export const BOM_STATUS: Record<BomStatus, { label: string; variant: Variant }> = {
  DRAFT: { label: 'Draft', variant: 'warning' },
  ACTIVE: { label: 'Active', variant: 'success' },
  ARCHIVED: { label: 'Archived', variant: 'neutral' },
}

export const MO_STATUS: Record<MoStatus, { label: string; variant: Variant }> = {
  DRAFT: { label: 'Draft', variant: 'neutral' },
  CONFIRMED: { label: 'Confirmed', variant: 'default' },
  IN_PROGRESS: { label: 'In Progress', variant: 'warning' },
  TO_CLOSE: { label: 'To Close', variant: 'warning' },
  DONE: { label: 'Done', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'neutral' },
}

export const ENTRY_KIND: Record<EntryKind, string> = { CONSUME: 'Consumption', OUTPUT: 'Finished output', SCRAP: 'Scrap' }

export const AVAILABILITY: Record<string, { label: string; variant: Variant }> = {
  OK: { label: 'Available', variant: 'success' },
  PARTIAL: { label: 'Partly available', variant: 'warning' },
  SHORT: { label: 'Not available', variant: 'danger' },
  UNKNOWN: { label: 'Stock unknown', variant: 'neutral' },
  CLOSED: { label: 'Closed', variant: 'neutral' },
}

export const MOVEMENT_LABEL: Record<string, string> = {
  RESERVATION: 'Reserved', RELEASE_RESERVATION: 'Reservation released',
  MRP_CONSUME: 'Component consumption', MRP_SCRAP: 'Component scrap', MRP_PRODUCE: 'Finished goods receipt',
  MRP_REVERSE_IN: 'Reversal (back to stock)', MRP_REVERSE_OUT: 'Reversal (out of stock)',
}

export const ACTIVITY_LABEL: Record<string, string> = {
  CREATED: 'Created', UPDATED: 'Updated', ACTIVATED: 'Activated', ARCHIVED: 'Archived', DELETED: 'Deleted', REVISED_FROM: 'New revision',
  CONFIRMED: 'Confirmed', STARTED: 'Production started', FINISHED: 'Marked as finished', REOPENED: 'Reopened', VALIDATED: 'Validated & posted',
  CANCELLED: 'Cancelled', REVERSED: 'Reversed', ACCURATE_RECORDED: 'Marked as entered in Accurate', SHORTAGE_REQUESTED: 'Shortage sent to Draft Purchase Request',
  ENTRY_CONSUME: 'Consumption recorded', ENTRY_OUTPUT: 'Output recorded', ENTRY_SCRAP: 'Scrap recorded', ENTRY_VOIDED: 'Entry voided',
}

export interface Activity { id: number; action: string; from_status: string | null; to_status: string | null; note: string | null; user_name: string | null; at: string | null }

export interface Bom {
  id: number
  code: string
  revision: number
  name: string | null
  status: BomStatus
  item_id: number
  product_code: string | null
  product_name: string | null
  base_unit: string | null
  effective_date: string | null
  lines_count: number
}

export interface BomLine { id: number; item_id: number; code: string | null; description: string | null; qty: number; qty_text: string; base_unit: string | null; note: string | null; item_active: boolean }

export interface BomDetail extends Bom {
  notes: string | null
  created_by_name: string | null
  created_at: string | null
  activated_by_name: string | null
  activated_at: string | null
  archived_at: string | null
  lines: BomLine[]
  revisions: { id: number; code: string; revision: number; status: BomStatus; activated_at: string | null; archived_at: string | null }[]
  used_by: number
  activity: Activity[]
}

export interface Mo {
  id: number
  number: string
  status: MoStatus
  priority: 'NORMAL' | 'URGENT'
  item_id: number
  product_code: string | null
  product_name: string | null
  base_unit: string | null
  bom_code: string
  bom_revision: number
  planned_qty: number
  output_qty: number
  consumed_qty: number
  scrap_qty: number
  scrap_product_qty: number
  planned_start: string | null
  planned_finish: string | null
  responsible_id: number | null
  responsible_name: string | null
  started_at: string | null
  done_at: string | null
  accurate_recorded: boolean
  reversed: boolean
  /** validated before the warehouse-door rule: the MO moved stock itself */
  posts_stock: boolean
}

export interface MoComponent {
  component_id: number
  item_id: number
  code: string | null
  description: string | null
  base_unit: string | null
  qty_per_unit: number
  required: number
  on_hand: number
  reserved_for_mo: number
  reserved_other: number
  free: number
  available_for_mo: number
  consumed: number
  scrapped: number
  shortage: number
  is_extra: boolean
  /** handed over by the warehouse (Item Request → Delivery Order) / asked so far */
  issued: number
  requested: number
  stock_known: boolean
  status: keyof typeof AVAILABILITY
  accurate_qty: number | null
  accurate_synced_at: string | null
}

export interface MoEntry {
  id: number
  kind: EntryKind
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

export interface MoMovement {
  id: number
  type: string
  direction: number
  qty: number
  item_code: string | null
  item_name: string | null
  warehouse: string | null
  actual_before: number
  actual_after: number
  reserved_before: number
  reserved_after: number
  note: string | null
  batch: string | null
  user_name: string | null
  created_at: string | null
}

type Step = { at: string | null; by: string | null }

export interface MoDetail extends Mo {
  notes: string | null
  mrp_bom_id: number
  bom_status: BomStatus | null
  bom_changed: boolean
  created_by_name: string | null
  created_at: string | null
  steps: Record<'confirmed' | 'started' | 'finished' | 'done' | 'cancelled' | 'reversed' | 'accurate_recorded', Step>
  cancel_reason: string | null
  accurate_refs: string | null
  components: MoComponent[]
  entries: MoEntry[]
  movements: MoMovement[]
  activity: Activity[]
  transitions: MoStatus[]
  gate: import('@/components/WarehouseGatePanel').GateInfo
}

export interface MrpItem { id: number; code: string; description: string; unit: string | null; available: number; stock_known: boolean; active_bom_id: number | null }
export interface MrpUnit { unit_id: number; code: string; ratio: number }

export interface MrpDashboard {
  counts: Record<MoStatus, number>
  boms: { active: number; draft: number }
  done_30d: number
  output_30d: number
  not_in_accurate: number
  urgent_open: number
}

export type ReportType = 'summary' | 'consumption' | 'output' | 'scrap' | 'trace'

// ------------------------------------------------------------------ queries

export function useBoms(params: { search?: string; status?: string; item_id?: number; page?: number }) {
  return useQuery({
    queryKey: ['mrp', 'boms', params],
    queryFn: async () => (await api.get<Paginated<Bom>>('/api/mrp/boms', { params })).data,
    placeholderData: keepPreviousData,
  })
}

export function useBom(id: number | null) {
  return useQuery({
    queryKey: ['mrp', 'boms', id],
    enabled: !!id,
    queryFn: async () => (await api.get<{ data: BomDetail }>(`/api/mrp/boms/${id}`)).data.data,
  })
}

export function useMos(params: { search?: string; status?: string; page?: number; not_in_accurate?: boolean; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['mrp', 'mos', params],
    queryFn: async () => (await api.get<Paginated<Mo>>('/api/mrp/productions', { params: { ...params, not_in_accurate: params.not_in_accurate ? 1 : undefined } })).data,
    placeholderData: keepPreviousData,
  })
}

export function useMo(id: number) {
  return useQuery({
    queryKey: ['mrp', 'mos', id],
    queryFn: async () => (await api.get<{ data: MoDetail }>(`/api/mrp/productions/${id}`)).data.data,
  })
}

export function useMrpDashboard() {
  return useQuery({ queryKey: ['mrp', 'dashboard'], queryFn: async () => (await api.get<{ data: MrpDashboard }>('/api/mrp/dashboard')).data.data })
}

export function useMrpItems(q: string, enabled = true) {
  return useQuery({
    queryKey: ['mrp', 'items', q],
    enabled: enabled && q.trim().length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<{ data: MrpItem[] }>('/api/mrp/items', { params: { q } })).data.data,
  })
}

export function useMrpUnits(itemId: number | null) {
  return useQuery({
    queryKey: ['mrp', 'units', itemId],
    enabled: !!itemId,
    queryFn: async () => (await api.get<{ data: MrpUnit[] }>(`/api/mrp/items/${itemId}/units`)).data.data,
  })
}

export function useMrpUsers(enabled = true) {
  return useQuery({ queryKey: ['mrp', 'users'], enabled, queryFn: async () => (await api.get<{ data: { id: number; name: string }[] }>('/api/mrp/users')).data.data })
}

export function useMrpReport<T = Record<string, unknown>>(type: ReportType, params: { from?: string; to?: string; item_id?: number | null }) {
  return useQuery({
    queryKey: ['mrp', 'report', type, params],
    enabled: type !== 'trace' || !!params.item_id,
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<{ data: T[] }>('/api/mrp/reports', { params: { type, ...params } })).data.data,
  })
}

// ------------------------------------------------------------------ mutations

export interface BomPayload { item_id?: number; name?: string | null; effective_date?: string | null; notes?: string | null; lines: { item_id: number; qty: string; note?: string | null }[] }

export function useSaveBom() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id?: number; data: BomPayload }) =>
      (id ? await api.put<{ data: BomDetail }>(`/api/mrp/boms/${id}`, data) : await api.post<{ data: BomDetail }>('/api/mrp/boms', data)).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mrp'] }),
  })
}

export function useBomStep(id: number) {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['mrp'] })
  const post = async (path: string) => (await api.post<{ data: BomDetail }>(`/api/mrp/boms/${id}/${path}`)).data.data
  return {
    activate: useMutation({ mutationFn: () => post('activate'), onSuccess }),
    archive: useMutation({ mutationFn: () => post('archive'), onSuccess }),
    revise: useMutation({ mutationFn: () => post('revise'), onSuccess }),
    remove: useMutation({ mutationFn: async () => api.delete(`/api/mrp/boms/${id}`), onSuccess }),
  }
}

export interface MoPayload { item_id?: number; bom_id?: number; planned_qty?: string; planned_start?: string | null; planned_finish?: string | null; responsible_id?: number | null; priority?: 'NORMAL' | 'URGENT'; notes?: string | null }

export function useSaveMo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id?: number; data: MoPayload }) =>
      (id ? await api.put<{ data: MoDetail }>(`/api/mrp/productions/${id}`, data) : await api.post<{ data: MoDetail }>('/api/mrp/productions', data)).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mrp'] }),
  })
}

export interface EntryPayload { kind: EntryKind; item_id?: number | null; qty: string; unit?: string | null; entry_date?: string | null; reason?: string | null; note?: string | null; client_key: string }

export function useMoStep(id: number) {
  const qc = useQueryClient()
  const onSuccess = (data: MoDetail) => { qc.setQueryData(['mrp', 'mos', id], data); void qc.invalidateQueries({ queryKey: ['mrp'] }) }
  const post = async (path: string, body?: Record<string, unknown>) => (await api.post<{ data: MoDetail }>(`/api/mrp/productions/${id}/${path}`, body ?? {})).data.data
  return {
    confirm: useMutation({ mutationFn: () => post('confirm'), onSuccess }),
    start: useMutation({ mutationFn: () => post('start'), onSuccess }),
    finish: useMutation({ mutationFn: () => post('finish'), onSuccess }),
    reopen: useMutation({ mutationFn: (note?: string | null) => post('reopen', { note }), onSuccess }),
    validate: useMutation({ mutationFn: () => post('validate'), onSuccess }),
    cancel: useMutation({ mutationFn: (reason?: string | null) => post('cancel', { reason }), onSuccess }),
    reverse: useMutation({ mutationFn: (reason: string) => post('reverse', { reason }), onSuccess }),
    accurate: useMutation({ mutationFn: (refs: string) => post('accurate', { refs }), onSuccess }),
    addEntry: useMutation({ mutationFn: (data: EntryPayload) => post('entries', data as unknown as Record<string, unknown>), onSuccess }),
    voidEntry: useMutation({
      mutationFn: async (entryId: number) => (await api.delete<{ data: MoDetail }>(`/api/mrp/productions/${id}/entries/${entryId}`)).data.data,
      onSuccess,
    }),
    requestComponents: useMutation({
      mutationFn: async () => (await api.post<{ data: { id: number; number: string } }>(`/api/mrp/productions/${id}/request-components`)).data.data,
      onSuccess: () => qc.invalidateQueries({ queryKey: ['mrp'] }),
    }),
    linkReceipt: useMutation({ mutationFn: async (noRi: string) => (await api.post<{ data: MoDetail }>(`/api/mrp/productions/${id}/receipts`, { no_ri: noRi })).data.data, onSuccess }),
    unlinkReceipt: useMutation({ mutationFn: async (noRi: string) => (await api.delete<{ data: MoDetail }>(`/api/mrp/productions/${id}/receipts`, { data: { no_ri: noRi } })).data.data, onSuccess }),
    shortage: useMutation({
      mutationFn: async () => (await api.post<{ data: { id: number; number: string; lines: number } }>(`/api/mrp/productions/${id}/shortage-request`)).data.data,
      onSuccess: () => qc.invalidateQueries({ queryKey: ['mrp', 'mos', id] }),
    }),
  }
}

// ------------------------------------------------------------------ display

export const fmtQty = (n: number | null | undefined, max = 6) => Number(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: max })
export const fmtDate = (v: string | null | undefined) => (v ? new Date(v.length <= 10 ? v + 'T00:00:00' : v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-')
export const fmtDateTime = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '-')
/** a fresh key per form submit: the server records a resent one only once */
export const newClientKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
