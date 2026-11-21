import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

/**
 * Stock Opname — the controlled workflow (backend StockOpnameWorkflowController):
 * DRAFT → CONFIRMED → COUNTING → REVIEW ⇄ RECOUNT → WAITING_APPROVAL → POSTED → DONE (and CANCELLED).
 * The server says which actions this user may take (`actions`); the screen shows exactly those.
 */
export type FlowStatus = 'DRAFT' | 'CONFIRMED' | 'COUNTING' | 'REVIEW' | 'RECOUNT' | 'WAITING_APPROVAL' | 'POSTED' | 'DONE' | 'CANCELLED'

export type FlowAction =
  | 'edit' | 'confirm' | 'start_counting' | 'count' | 'finish_counting' | 'review' | 'request_approval'
  | 'recount' | 'approve' | 'reject' | 'close' | 'cancel' | 'correction'

export interface FlowLine {
  id: number
  item_id: number
  item_code: string | null
  description: string | null
  uom: string | null
  location: string | null
  physical_qty: number | null
  note: string | null
  count_status: 'PENDING' | 'COUNTED' | string
  review_status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RECOUNT' | string
  review_note: string | null
  recount_reason: string | null
  count_round: number | null
  counted_by: string | null
  counted_at: string | null
  counts_count: number | null
  /** Blind count: only for a reviewer / auditor — the keys are absent otherwise. */
  system_qty?: number
  variance?: number | null
  variance_pct?: number | null
  variance_kind?: 'PLUS' | 'MINUS' | 'MATCH' | null
  current_qty?: number | null
  moved_since_snapshot?: number | null
  adjustment?: { qty_before: number; qty_after: number; difference: number; movement_id: number | null } | null
}

export interface FlowSummary {
  lines: number
  counted: number
  uncounted: number
  recount: number
  recount_open: number
  variance_lines?: number
  plus_qty?: number
  minus_qty?: number
  accuracy?: number | null
  excluded?: number
  adjusted?: number
}

export interface FlowOpname {
  id: number
  number: string
  status: string
  flow_status: FlowStatus | string
  from_accurate: boolean
  scope: 'ALL' | 'SELECTED' | 'OPENING'
  count_method: 'FULL' | 'CYCLE'
  count_round: number
  warehouse: { id: number; code: string; name: string } | null
  location: { id: number; code: string } | null
  category: { id: number; name: string; path: string | null } | null
  scheduled_date: string | null
  notes: string | null
  responsible: { id: number; name: string } | null
  team: Array<{ id: number; name: string }>
  created_by: string | null
  created_at: string | null
  confirmed_at: string | null
  started_at: string | null
  counter: string | null
  snapshot_at: string | null
  submitted_at: string | null
  reviewed_at: string | null
  reviewer: string | null
  review_note: string | null
  approval_requested_at: string | null
  approved_at: string | null
  approver: string | null
  approval_note: string | null
  posted_at: string | null
  poster: string | null
  posting_batch: string | null
  closed_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  correction_of: { id: number; number: string } | null
  corrections: Array<{ id: number; number: string; flow_status: string }>
  can_see_system: boolean
  actions: FlowAction[]
  summary: FlowSummary
  lines: FlowLine[]
}

export interface FlowEvent {
  id: number
  event: string
  from_status: string | null
  to_status: string | null
  note: string | null
  meta: Record<string, unknown> | null
  user: string | null
  line_id: number | null
  at: string | null
  opname?: { id: number; number: string } | null
}

export interface LineCount {
  id: number
  round: number
  counted_qty: number
  note: string | null
  recount_reason: string | null
  source: 'MANUAL' | 'SCAN'
  counted_by: string | null
  counted_at: string | null
}

export interface FormOptions {
  warehouses: Array<{ id: number; code: string; name: string }>
  locations: Array<{ id: number; warehouse_id: number; code: string; description: string | null }>
  categories: Array<{ id: number; parent_id: number | null; name: string; level: number; path: string | null }>
  users: Array<{ id: number; name: string; counter: boolean; reviewer: boolean }>
}

export interface OrderInput {
  scheduled_date: string
  warehouse_id?: number
  warehouse_location_id?: number | null
  category_id?: number | null
  scope?: 'ALL' | 'SELECTED'
  item_ids?: number[]
  count_method?: 'FULL' | 'CYCLE'
  cycle_days?: number | null
  cycle_limit?: number | null
  responsible_id?: number | null
  team_ids?: number[]
  notes?: string | null
}

export interface DashboardFilters {
  date_from?: string
  date_to?: string
  warehouse_id?: number
  status?: string
  responsible_id?: number
}

export interface OpnameDashboard {
  kpi: { total: number; draft: number; counting: number; review: number; approval: number; done: number; cancelled: number; variance_lines: number; accuracy: number | null }
  by_status: Record<string, number>
  by_warehouse: Array<{ id: number; code: string; name: string; total: number; finished: number; open: number }>
  accuracy: Array<{ month: string; counted: number; matched: number; accuracy: number | null }>
  top_variances: Array<{
    line_id: number; opname_id: number; number: string; flow_status: string; item_code: string; description: string
    system_qty: number; physical_qty: number; variance: number; variance_pct: number | null; review_status: string
  }> | null
  todo: Array<{ id: number; number: string; flow_status: string; action: string; warehouse: string | null; scheduled_date: string | null; items_count: number; late: boolean }>
  recent: FlowEvent[]
  can_see_system: boolean
}

export interface AdjustmentRow {
  id: number
  item_code: string | null
  description: string | null
  unit: string | null
  warehouse: string | null
  qty_before: number
  qty_after: number
  difference: number
  reason: string
  movement_id: number | null
  approved_by: string | null
  approved_at: string | null
  opname: { id: number | null; number: string | null }
}

const DETAIL = (id: number) => ['opname-flow', id] as const

export function useOpnameDetail(id: number | null) {
  return useQuery({
    queryKey: DETAIL(id ?? 0),
    enabled: id != null && !Number.isNaN(id),
    queryFn: async () => (await api.get<{ data: FlowOpname }>(`/api/stock-opnames/${id}/detail`)).data.data,
    retry: false,
  })
}

export function useOpnameEvents(id: number, enabled = true) {
  return useQuery({
    queryKey: ['opname-flow', id, 'events'],
    enabled,
    queryFn: async () => (await api.get<{ data: FlowEvent[] }>(`/api/stock-opnames/${id}/events`)).data.data,
  })
}

export function useLineCounts(opnameId: number, lineId: number | null) {
  return useQuery({
    queryKey: ['opname-flow', opnameId, 'counts', lineId],
    enabled: lineId != null,
    queryFn: async () => (await api.get<{ data: LineCount[] }>(`/api/stock-opnames/${opnameId}/lines/${lineId}/counts`)).data.data,
  })
}

export function useFormOptions() {
  return useQuery({
    queryKey: ['opname-flow', 'form-options'],
    queryFn: async () => (await api.get<{ data: FormOptions }>('/api/stock-opnames/form-options')).data.data,
    staleTime: 5 * 60_000,
  })
}

export function useOpnameDashboard(filters: DashboardFilters) {
  return useQuery({
    queryKey: ['opname-flow', 'dashboard', filters],
    queryFn: async () => (await api.get<{ data: OpnameDashboard }>('/api/stock-opnames/dashboard', { params: filters })).data.data,
    placeholderData: keepPreviousData,
    retry: false,
  })
}

export function useOpnameAdjustments(params: { opname_id?: number; page?: number }, enabled = true) {
  return useQuery({
    queryKey: ['opname-flow', 'adjustments', params],
    enabled,
    queryFn: async () => (await api.get<{ data: AdjustmentRow[]; meta: { total: number; last_page: number } }>('/api/stock-opnames/adjustments', { params })).data,
  })
}

export function useCreateOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: OrderInput) => (await api.post<{ data: FlowOpname }>('/api/stock-opnames/orders', body)).data.data,
    onSuccess: (o) => {
      qc.setQueryData(DETAIL(o.id), o)
      qc.invalidateQueries({ queryKey: ['opnames'] })
      qc.invalidateQueries({ queryKey: ['opname-flow', 'dashboard'] })
    },
    meta: { successMessage: 'Stock opname draft created.' },
  })
}

/** Every workflow step answers with the whole document: it replaces the cached one. */
export function useFlowActions(id: number) {
  const qc = useQueryClient()
  const apply = (o: FlowOpname) => {
    qc.setQueryData(DETAIL(id), o)
    qc.invalidateQueries({ queryKey: ['opname-flow', id, 'events'] })
    qc.invalidateQueries({ queryKey: ['opnames'] })
    qc.invalidateQueries({ queryKey: ['opname-flow', 'dashboard'] })
    qc.invalidateQueries({ queryKey: ['reminders'] })
  }
  const useStep = <T,>(path: string, msg: string, method: 'post' | 'put' | 'delete' = 'post') => useMutation({
    mutationFn: async (body: T) => (await api.request<{ data: FlowOpname; meta?: { posted?: boolean; already_posted?: boolean } }>({ url: `/api/stock-opnames/${id}/${path}`, method, data: body })).data,
    onSuccess: (r) => apply(r.data),
    meta: { successMessage: msg },
  })
  return {
    updateDraft: useStep<OrderInput>('draft', 'Draft saved.', 'put'),
    addLines: useStep<{ item_ids: number[] }>('lines', 'Items added.'),
    confirm: useStep<void>('confirm', 'Order confirmed — the item list is fixed.'),
    startCounting: useStep<void>('start-counting', 'Counting started. Book quantities are frozen now.'),
    finishCounting: useStep<void>('finish-counting', 'Count finished — sent for review.'),
    reviewDecisions: useStep<{ decisions: Array<{ id: number; decision: 'ACCEPT' | 'EXCLUDE'; note?: string | null }> }>('review-decisions', 'Review saved.'),
    recount: useStep<{ line_ids: number[]; reason?: string }>('recount', 'Recount requested.'),
    requestApproval: useStep<{ note?: string }>('request-approval', 'Sent to the supervisor for approval.'),
    approve: useStep<{ note?: string }>('approve', 'Approved and posted to the Stock Ledger.'),
    reject: useStep<{ note: string }>('reject', 'Sent back to review.'),
    close: useStep<{ note?: string }>('close', 'Stock opname closed.'),
    cancel: useStep<{ reason: string }>('cancel', 'Stock opname cancelled.'),
    removeLine: useMutation({
      mutationFn: async (lineId: number) => (await api.delete<{ data: FlowOpname }>(`/api/stock-opnames/${id}/lines/${lineId}`)).data.data,
      onSuccess: apply,
      meta: { successMessage: 'Item removed.' },
    }),
    correction: useMutation({
      mutationFn: async (body: { note?: string }) => (await api.post<{ data: FlowOpname }>(`/api/stock-opnames/${id}/correction`, body)).data.data,
      onSuccess: (o) => { qc.setQueryData(DETAIL(o.id), o); qc.invalidateQueries({ queryKey: ['opname-flow', id] }) },
      meta: { successMessage: 'Correction draft created.' },
    }),
    // one line, saved on leaving the field: the answer is the line only (counting is many small saves)
    count: useMutation({
      mutationFn: async (p: { lineId: number; physical_qty: number; note?: string | null; source?: 'MANUAL' | 'SCAN' }) =>
        (await api.post<{ data: FlowLine }>(`/api/stock-opnames/${id}/lines/${p.lineId}/count`, { physical_qty: p.physical_qty, note: p.note ?? undefined, source: p.source })).data.data,
      onSuccess: (line) => qc.setQueryData<FlowOpname>(DETAIL(id), (o) => {
        if (!o) return o
        const lines = o.lines.map((l) => (l.id === line.id ? { ...l, ...line } : l))
        const counted = lines.filter((l) => l.count_status === 'COUNTED').length
        return { ...o, lines, summary: { ...o.summary, counted, uncounted: lines.length - counted,
          recount_open: lines.filter((l) => l.review_status === 'RECOUNT' && l.count_status !== 'COUNTED').length } }
      }),
      meta: { silent: true },
    }),
  }
}
