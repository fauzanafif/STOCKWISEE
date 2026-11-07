import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/notify'
import { api } from '@/lib/api'
import type { Paginated } from '@/types/inventory'

/**
 * Request Barang (the parent transaction): karyawan ask (free text) → admin gudang proposes each line as
 * NPBG (from stock, with a quantity) / PPB (to buy), or rejects it. NPBG lines go Manager → Direktur (they may
 * lower the quantity or send it back) → Gudang gives from real stock, maybe in several NPBG + serah terima
 * (the shortage to a Draft PPB) → Selesai once nothing is left (or the rest is closed).
 */
export type ItemRequestStatus =
  | 'MENUNGGU' | 'DIPROSES' | 'PERLU_PERBAIKAN'
  | 'APPROVAL_MANAGER' | 'APPROVAL_DIREKTUR' | 'DISIAPKAN' | 'SIAP_DISERAHKAN'
  | 'DIPENUHI_SEBAGIAN' | 'MENUNGGU_PENGADAAN' | 'MENUNGGU_BARANG'
  | 'SELESAI' | 'DITOLAK' | 'DIBATALKAN'
/** One item's own status (the request's status sums them up); DITUTUP = the rest was closed. */
export type LineStatus = ItemRequestStatus | 'DITUTUP'
export type LineDecision = 'NPBG' | 'PPB' | 'TOLAK'
export type FormType = 'ATK' | 'MAINTENANCE' | 'DISTRIBUSI' | 'MANUFAKTUR' | 'UMUM'
export type Urgency = 'URGENT' | 'NORMAL'

/** One Request Barang form (backend App\Support\ItemRequestForms): what it asks besides the items. */
export interface RequestForm {
  type: FormType
  label: string
  /** label of the form's own extra field, e.g. "Untuk unit / mesin / lokasi"; null = no extra field */
  detail_label: string | null
  /** always false now: urgency is set by admin gudang (useSetUrgency), never asked in the form */
  urgency: boolean
  default_divisi: string | null
}

export const URGENCY_LABEL: Record<Urgency, string> = { URGENT: 'Urgent', NORMAL: 'Not Urgent' }

export interface ItemRequest {
  /** images the requester attached (img1..img3), on the detail and the Approval page */
  images?: string[]
  id: number
  number: string
  status: ItemRequestStatus
  status_label: string
  /** APP = made while logged in, LINK = sent through a share link (no account) */
  source: 'APP' | 'LINK'
  form_type: FormType
  form_label: string
  urgency: Urgency | null
  form_detail: string | null
  form_detail_label: string | null
  requester_id: number | null
  requester_name: string | null
  requester_contact: string | null
  /** "Jaringan Kantor" / "Outside Office" / "Tidak Diketahui" */
  requester_location: string | null
  divisi: string | null
  needed_date: string | null
  note: string | null
  /** admin gudang's note at the verification (for the approvers and the requester) */
  verify_note?: string | null
  lines_count: number
  open_lines_count: number
  processed_at: string | null
  created_at: string
  /** the first items asked (list only) */
  items_preview?: string[]
  /** per item (list): approved (or asked) / handed over so far — a partial handover reads "10/5" */
  progress?: { name: string; qty: number; done: number; unit: string | null }[]
}

/** One of the 5 stock recommendations for a free-text line (ItemRecommender). */
export interface StockRecommendation {
  id: number
  code: string
  description: string
  unit: string | null
  available: number | null
  stock_known: boolean
  /** match, 0–100 */
  score: number
}

export interface ItemRequestLine {
  id: number
  /** images of this item (img1..img3), shown beside its name */
  images?: string[]
  item_id: number | null
  kode_barang: string | null
  /** the Master Produk name once admin gudang matched it (before: what the requester typed) */
  deskripsi_barang: string
  /** what the requester typed (kept once the line took the master name) */
  deskripsi_peminta?: string | null
  qty: number
  satuan: string | null
  /** as asked, kept beside the quantity in the item's Base UOM */
  requested_qty?: number | null
  requested_unit?: string | null
  /** frozen at the verification; null: the same unit, or a word the master does not know */
  unit_ratio?: number | null
  /** a word that is no unit of the master: counted as written, waiting for mapping */
  uom_unmapped?: boolean
  note: string | null
  /** given less than asked at the verification: why (admin gudang) */
  short_reason?: string | null
  decision: LineDecision | null
  reject_reason: string | null
  npbg_id: number | null
  no_npbg: string | null
  ppb_id: number | null
  no_ppb: string | null
  /** a PPB line waits in a Draft PPB until it is submitted (then ppb_id / no_ppb are set) */
  ppb_draft_id?: number | null
  ppb_draft_number?: string | null
  ppb_draft_status?: 'DRAFT' | 'DIAJUKAN' | 'DIBATALKAN' | null
  decided_at: string | null
  /** the official need (admin's proposal, maybe lowered by Manager / Direktur); null = not decided */
  approved_qty: number | string | null
  /** handed over so far (all serah terima together) */
  fulfilled_qty: number
  /** still owed: approved − handed over (0 once closed) */
  remaining: number
  closed_at: string | null
  closed_reason: string | null
  line_status: LineStatus
  line_status_label: string
  /** given from stock: quantity and its NPBG(s) (null = nothing given yet) */
  npbg?: { qty: number; docs: { no: string; npbg_id: number | null; handed: boolean }[] } | null
  /** to be bought: quantity and where it stands (Draft PPB → PPB → PO → RI) */
  ppb?: { qty: number; stage: string; draft_id: number; draft_number: string; ppb_id: number | null; no_ppb: string | null; po_id: number | null; po_number: string | null } | null
  item_description: string | null
  /** free stock of the matched item now (not held by prepared NPBG); null = not matched / unknown */
  available?: number | null
  /** the stock itself (Master Produk): what prepared NPBG hold leaves it only with the serah terima */
  on_hand?: number | null
  recommendations: StockRecommendation[]
}

/** One step of the status tracker (backend ItemRequestApprovalService::timeline). */
export interface TimelineStep {
  key: string
  label: string
  state: 'done' | 'current' | 'rejected' | 'cancelled' | 'todo' | 'skipped'
  at: string | null
  by: string | null
  note: string | null
}

export interface ApprovalStep {
  stage: 'ADMIN' | 'MANAGER' | 'DIREKTUR' | 'GUDANG' | 'SERAH_TERIMA'
  /** RETURN = sent back to admin gudang; FULFILL = an NPBG made by Gudang; SHORTAGE = to Draft PPB; CLOSE = rest closed */
  action: 'VALIDASI' | 'APPROVE' | 'REJECT' | 'RETURN' | 'FULFILL' | 'SHORTAGE' | 'CLOSE' | 'HANDOVER'
  note: string | null
  user_name: string | null
  at: string | null
}

export interface HandoverInfo {
  at: string
  by: string | null
  received_by: string | null
  note: string | null
  photo: boolean
  signature: boolean
}

/** What Gudang may give now of one line (backend ItemRequestFulfillmentService::plan). */
export interface FulfillPlanLine {
  line_id: number
  item_id: number | null
  kode_barang: string | null
  deskripsi: string
  satuan: string | null
  approved: number
  fulfilled: number
  remaining: number
  /** stock not taken by other requests; null = unknown / not matched */
  available: number | null
  suggested: number
  /** the rest is already in a Draft PPB / PPB */
  in_procurement: boolean
}

/** One giving of goods: its NPBG (#1, #2 = NPBG lanjutan …) and its serah terima. */
export interface Fulfillment {
  id: number
  seq: number
  /** DISIAPKAN: prepared, waiting for its serah terima (Gudang: one step) · SIAP: older ready ones · DISERAHKAN */
  status: 'DISIAPKAN' | 'SIAP' | 'DISERAHKAN'
  no_npbg: string | null
  prepared_at: string | null
  prepared_by: string | null
  handed_at: string | null
  handed_by: string | null
  received_by: string | null
  note: string | null
  photo: boolean
  signature: boolean
  lines: { id: number; line_id: number; deskripsi: string | null; satuan: string | null; qty: number; handed_qty: number | null; npbg_id: number | null }[]
}

export interface ItemRequestDetail extends ItemRequest {
  processed_by_name: string | null
  lines: ItemRequestLine[]
  timeline: TimelineStep[]
  approval_log: ApprovalStep[]
  /** this user can approve / reject the current step */
  can_approve: boolean
  /** who this user approves as now; DIREKTUR at the Manager step = bypass (Manager approved automatically) */
  approve_as?: 'MANAGER' | 'DIREKTUR' | 'GUDANG' | null
  /** Gudang: prepare & hand over the prepared NPBG now (its quantities fixed in the serah terima) */
  can_handover: boolean
  /** picked up by a representative (the code / QR only for the requester) */
  proxy?: RequestProxy | null
  /** the requester may name a representative now */
  can_proxy?: boolean
  /** Gudang can give from stock now (no NPBG waiting for its serah terima) */
  can_fulfill?: boolean
  /** what is left can be closed officially */
  can_close?: boolean
  plan?: FulfillPlanLine[]
  fulfillments?: Fulfillment[]
  /** the request's single serah terima of the old flow (newer ones: fulfillments) */
  handover: HandoverInfo | null
  /** the requester's Cek Permintaan token (only for the requester / admin) */
  track_token: string | null
}

export interface NewRequestLine {
  deskripsi_barang: string
  qty: number
  satuan?: string | null
  note?: string | null
}

export interface ItemRequestCreatePayload {
  /** up to 3 images (data URLs) shown from the request to its end */
  images?: string[]
  form_type?: FormType
  urgency?: Urgency | null
  form_detail?: string | null
  divisi?: string | null
  /** the requester's phone (in-app: from Data Pekerja, may be changed) */
  contact?: string | null
  needed_date?: string | null
  note?: string | null
  lines: NewRequestLine[]
}

/** The signed-in requester's own data (Data Pekerja), to fill the Buat Request form. */
export interface MyRequestProfile { name: string; username: string; contact: string | null; divisi: string | null; position: string | null }

export function useMyRequestProfile(enabled: boolean) {
  return useQuery({
    queryKey: ['item-requests', 'my-profile'],
    queryFn: async () => (await api.get<{ data: MyRequestProfile }>('/api/item-requests/my-profile')).data.data,
    enabled, staleTime: 5 * 60_000,
  })
}

/** Admin gudang verifies: per line the master item (null = new item) and the quantity proposed. */
export interface ProcessPayload {
  /** per requested line: one Master Produk item, or several (items: the line is split, one per item) */
  lines: Record<number, { item_id?: number | null; qty?: number; items?: { item_id: number; qty: number }[]; reason?: string | null; unit?: string | null }>
  /** admin gudang's note, seen by the approvers and the requester (optional) */
  note?: string | null
  npbg?: { pelanggan?: string | null; tipe_npbg?: 'Penjualan' | 'Non Penjualan' }
}

export const REQUEST_STATUS: Record<ItemRequestStatus, { label: string; variant: 'warning' | 'default' | 'success' | 'danger' | 'neutral' }> = {
  MENUNGGU: { label: 'Waiting for admin', variant: 'warning' },
  DIPROSES: { label: 'Partly processed', variant: 'default' },
  PERLU_PERBAIKAN: { label: 'Needs correction', variant: 'warning' },
  APPROVAL_MANAGER: { label: 'Manager Approval', variant: 'default' },
  APPROVAL_DIREKTUR: { label: 'Director Approval', variant: 'default' },
  DISIAPKAN: { label: 'Prepare & hand over', variant: 'default' },
  SIAP_DISERAHKAN: { label: 'Ready for handover', variant: 'warning' },
  DIPENUHI_SEBAGIAN: { label: 'Partly fulfilled', variant: 'default' },
  MENUNGGU_PENGADAAN: { label: 'Waiting for procurement', variant: 'default' },
  MENUNGGU_BARANG: { label: 'Waiting for items', variant: 'default' },
  SELESAI: { label: 'Done', variant: 'success' },
  DITOLAK: { label: 'Rejected', variant: 'danger' },
  DIBATALKAN: { label: 'Cancelled', variant: 'neutral' },
}

/** A Direktur approving while it still waits for the Manager: the Manager step is approved with it. */
export const isBypass = (r: { status: ItemRequestStatus; approve_as?: string | null }) => r.status === 'APPROVAL_MANAGER' && r.approve_as === 'DIREKTUR'

/** Whoever holds one of these sees the Approval page (Manager, Direktur, Lapangan Gudang). */
export const APPROVAL_PERMISSIONS = ['item_request.approve_manager', 'item_request.approve_director', 'item_request.handover',
  'ppb.approve_manager', 'ppb.approve_director', 'po.approve_director', 'npbg.approve_manager', 'npbg.approve_director']

/** STOCKWISE PPB (Manager → Direktur) and PO (Direktur) waiting for this user. */
export interface PurchasingApprovals {
  ppb: { id: number; no_ppb: string; tgl_ppb: string; lines: number; peminta: string | null; divisi: string | null; status: string; step: 'MANAGER' | 'DIREKTUR' | null; items: string[] }[]
  po: { id: number; number: string; vendor: string | null; total: number; items_count: number; off_pick: number; from_ppb: string | null; date: string | null }[]
  /** manual NPBG (not from a Request Barang): Manager → Direktur */
  npbg?: { id: number; no_npbg: string; tgl_npbg: string | null; pelanggan: string | null; peminta: string | null; divisi: string | null; step: 'MANAGER' | 'DIREKTUR' | null; items: string[] }[]
  total: number
}

export function usePurchasingApprovals(enabled: boolean) {
  return useQuery({
    ...LIVE,
    queryKey: ['item-requests', 'approvals', 'purchasing'],
    enabled,
    queryFn: async () => (await api.get<{ data: PurchasingApprovals }>('/api/approvals/purchasing')).data.data,
  })
}

/** The statuses of the approval flow, in order (the "Dalam approval" filter). */
export const APPROVAL_STATUSES: ItemRequestStatus[] = ['APPROVAL_MANAGER', 'APPROVAL_DIREKTUR', 'DISIAPKAN', 'SIAP_DISERAHKAN']

/** Who acts at each approval status, and what their approve button says. */
export const STAGE_INFO: Partial<Record<ItemRequestStatus, { who: string; approve: string; hint: string }>> = {
  APPROVAL_MANAGER: { who: 'Manager', approve: 'Approve', hint: 'Check the warehouse picks (items & quantity), then approve: passed on to the Director.' },
  APPROVAL_DIREKTUR: { who: 'Director', approve: 'Approve', hint: 'Already approved by Manager. Once approved the system issues from stock (Delivery Order) and buys the rest (Purchase Request).' },
  DISIAPKAN: { who: 'Warehouse', approve: 'Prepare & hand over', hint: 'Prepare items according to the approved Delivery Order. If the quantity is reduced, fill in the reason. Then Handover: photo, signature, done.' },
  SIAP_DISERAHKAN: { who: 'Warehouse', approve: 'Handover', hint: 'Prepare items according to the approved Delivery Order. If the quantity is reduced, fill in the reason. Then Handover: photo, signature, done.' },
}

/**
 * Live without a refresh: while the page is open (and the tab visible) the list,
 * the detail and the links poll the server, and catch up as soon as the tab is
 * shown again — a new request shows up for admin gudang, a decision for the requester.
 */
// changes elsewhere come in through useLiveSync (seconds); this is only the fallback
const LIVE = { refetchInterval: 60_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true } as const

export interface ItemRequestList extends Paginated<ItemRequest> {
  meta: Paginated<ItemRequest>['meta'] & {
    /** requests per status under the other filters (the flow tabs) */
    status_counts?: Partial<Record<ItemRequestStatus, number>>
    /** requesters under the other filters (the "Pemohon" filter) */
    requesters?: string[]
  }
}

export function useItemRequests(params: {
  search?: string
  /** one status, several comma-separated, or APPROVAL */
  status?: string
  form_type?: string
  requester?: string
  date_from?: string
  date_to?: string
  page?: number
  per_page?: number
}) {
  return useQuery({
    ...LIVE,
    queryKey: ['item-requests', params],
    queryFn: async () => (await api.get<ItemRequestList>('/api/item-requests', { params })).data,
    placeholderData: keepPreviousData,
  })
}

/** The forms a request can be made with (ATK, Maintenance General, …). */
export function useRequestForms() {
  return useQuery({
    queryKey: ['item-request-forms'],
    staleTime: 60 * 60_000,
    queryFn: async () => (await api.get<{ data: RequestForm[] }>('/api/item-request-forms')).data.data,
  })
}

export function useItemRequest(id: number | null) {
  return useQuery({
    ...LIVE,
    queryKey: ['item-requests', id],
    enabled: id != null,
    queryFn: async () => (await api.get<{ data: ItemRequestDetail }>(`/api/item-requests/${id}`)).data.data,
  })
}

export function useCreateItemRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: ItemRequestCreatePayload) => (await api.post<{ data: ItemRequestDetail }>('/api/item-requests', body)).data.data,
    meta: { successMessage: 'Request sent to the warehouse admin.' },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-requests'] }),
  })
}

export function useProcessItemRequest(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: ProcessPayload) => (await api.post<{ data: ItemRequestDetail }>(`/api/item-requests/${id}/process`, body)).data.data,
    meta: { successMessage: 'Verified, request sent to approval.' },
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['item-requests'] }),
      qc.invalidateQueries({ queryKey: ['npbg'] }),
      qc.invalidateQueries({ queryKey: ['ppb'] }),
    ]),
  })
}

/** Admin gudang picks a line's Master Produk item while verifying: saved at once, the Item table shows it. */
export function useMatchLine(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ lineId, itemId }: { lineId: number; itemId: number }) =>
      (await api.put<{ data: ItemRequestDetail }>(`/api/item-requests/${id}/lines/${lineId}/match`, { item_id: itemId })).data.data,
    meta: { successMessage: false },
    // the detail answer replaces the cached one: the Item table updates without waiting for a refetch
    onSuccess: (d) => qc.setQueryData(['item-requests', id], d),
  })
}

/** Admin gudang marks a request urgent (or not) — the requester never chooses it. */
export function useSetUrgency(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (urgency: Urgency | null) => (await api.put<{ data: ItemRequestDetail }>(`/api/item-requests/${id}/urgency`, { urgency })).data.data,
    meta: { successMessage: false },
    onSuccess: (_d, u) => {
      toast.success(u === 'URGENT' ? 'Marked urgent, shown on top.' : 'Urgent mark removed.')
      return qc.invalidateQueries({ queryKey: ['item-requests'] })
    },
  })
}

// ---------------------------------------------------------------- approval (Manager → Direktur → Gudang → serah terima)

export interface ApprovalRow extends ItemRequest {
  lines: Pick<ItemRequestLine, 'id' | 'item_id' | 'kode_barang' | 'deskripsi_barang' | 'qty' | 'satuan' | 'note' | 'decision' | 'npbg_id' | 'no_npbg' | 'approved_qty' | 'fulfilled_qty' | 'remaining' | 'available' | 'on_hand' | 'images' | 'deskripsi_peminta' | 'item_description' | 'short_reason'>[]
  can_approve: boolean
  can_handover: boolean
  can_fulfill?: boolean
  approve_as?: 'MANAGER' | 'DIREKTUR' | 'GUDANG' | null
  /** picked up by a representative: who (Gudang scans their code) */
  proxy?: RequestProxy | null
  last_step: ApprovalStep | null
  /** admin gudang's verification: who picked the Master Produk items, and when */
  verified_step?: ApprovalStep | null
  /** the NPBG waiting for its serah terima (Gudang hands it over from the Approval page) */
  fulfillments?: Pick<Fulfillment, 'id' | 'seq' | 'status' | 'no_npbg' | 'lines'>[]
}

export interface ApprovalList {
  data: ApprovalRow[]
  meta: { statuses: ItemRequestStatus[]; counts: Partial<Record<ItemRequestStatus, number>>; total: number }
}

export function useApprovals(scope: 'todo' | 'done', stage?: string) {
  return useQuery({
    ...LIVE,
    queryKey: ['item-requests', 'approvals', scope, stage ?? ''],
    queryFn: async () => (await api.get<ApprovalList>('/api/approvals', { params: { scope, stage: stage || undefined } })).data,
    placeholderData: keepPreviousData,
  })
}

/** The sidebar badge: how many requests wait for this user's step. */
export function useApprovalCount(enabled: boolean) {
  return useQuery({
    queryKey: ['item-requests', 'approvals', 'count'],
    enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    queryFn: async () => (await api.get<{ data: { total: number } }>('/api/approvals/count')).data.data.total,
  })
}

export function useDecideRequest(id: number) {
  const qc = useQueryClient()
  return useMutation({
    /** quantities: line id → approved qty (less or more than asked) */
    mutationFn: async (body: { action: 'APPROVE' | 'REJECT' | 'RETURN'; note?: string | null; quantities?: Record<number, number> }) =>
      (await api.post<{ data: ItemRequestDetail }>(`/api/item-requests/${id}/approval`, body)).data.data,
    meta: { successMessage: false },
    onSuccess: (d, b) => {
      toast.success(b.action === 'REJECT' ? `${d.number} rejected.` : b.action === 'RETURN' ? `${d.number} returned to the warehouse admin.` : `${d.number}: ${d.status_label}.`)
      return Promise.all([qc.invalidateQueries({ queryKey: ['item-requests'] }), qc.invalidateQueries({ queryKey: ['npbg'] })])
    },
  })
}

export interface HandoverPayload {
  /** JPEG data URL of the handover */
  photo: string
  /** PNG data URL of the receiver's signature */
  signature: string
  received_by: string
  note?: string | null
  /** fulfillment line id → qty really handed over (default: all prepared) */
  handed?: Record<number, number>
  /** fulfillment lines whose part not handed over is closed (not needed any more) */
  drop?: number[]
  /** picked up by a representative: the scanned QR text or the typed 6-digit code */
  proxy_code?: string
  /** fulfillment line id → why less than the approved NPBG is handed over */
  reasons?: Record<number, string>
}

/** Serah terima of the prepared NPBG (fulfillmentId), or — without it — of whatever is prepared now. */
export function useHandover(id: number, fulfillmentId?: number | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: HandoverPayload) => (await api.post<{ data: ItemRequestDetail }>(
      fulfillmentId ? `/api/item-requests/${id}/fulfillments/${fulfillmentId}/handover` : `/api/item-requests/${id}/handover`, body)).data.data,
    meta: { successMessage: false },
    onSuccess: (d) => {
      toast.success(d.status === 'SELESAI' ? `${d.number} done, all items handed over.` : `${d.number}: items handed over, the rest still in process.`)
      return Promise.all([qc.invalidateQueries({ queryKey: ['item-requests'] }), qc.invalidateQueries({ queryKey: ['npbg'] })])
    },
  })
}

/** Gudang gives what the stock has now: one NPBG; the shortage may go to a Draft PPB. */
export function useFulfill(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (lines: { line_id: number; qty: number; shortage_to_ppb: boolean }[]) =>
      (await api.post<{ data: ItemRequestDetail }>(`/api/item-requests/${id}/fulfillments`, { lines })).data.data,
    meta: { successMessage: false },
    onSuccess: (d) => {
      const f = d.fulfillments?.find((x) => x.status === 'DISIAPKAN')
      toast.success(f ? `Delivery Order ${f.no_npbg} created, items ready for handover.` : 'Shortage passed on to Draft Purchase Request.')
      return Promise.all([qc.invalidateQueries({ queryKey: ['item-requests'] }), qc.invalidateQueries({ queryKey: ['npbg'] }), qc.invalidateQueries({ queryKey: ['ppb-drafts'] })])
    },
  })
}

/** Close what is left (all lines, or some) with a reason. */
export function useCloseRemaining(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: { reason: string; line_ids?: number[] }) =>
      (await api.post<{ data: ItemRequestDetail }>(`/api/item-requests/${id}/close`, body)).data.data,
    meta: { successMessage: 'Remaining need closed.' },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-requests'] }),
  })
}

/** One serah terima's photo / signature as an object URL. */
export function useFulfillmentFile(id: number, fulfillmentId: number, slot: 'handover' | 'signature', enabled: boolean) {
  return useQuery({
    queryKey: ['item-requests', id, 'fulfillment-file', fulfillmentId, slot],
    enabled,
    staleTime: Infinity,
    queryFn: async () => URL.createObjectURL((await api.get(`/api/item-requests/${id}/fulfillments/${fulfillmentId}/file/${slot}`, { responseType: 'blob' })).data as Blob),
  })
}

/** The handover photo / signature as an object URL (the API needs the bearer token). */
export function useHandoverFile(id: number, slot: 'handover' | 'signature', enabled: boolean) {
  return useQuery({
    queryKey: ['item-requests', id, 'handover-file', slot],
    enabled,
    staleTime: Infinity,
    queryFn: async () => URL.createObjectURL((await api.get(`/api/item-requests/${id}/handover/${slot}`, { responseType: 'blob' })).data as Blob),
  })
}

/** The requester: a representative picks the goods up (new code), or not any more. */
/** A worker (data pekerja) who can pick up for the requester. */
export interface ProxyPerson { name: string; divisi: string | null }

export function useRequestProxy(id: number) {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['item-requests'] })
  return {
    create: useMutation({
      mutationFn: async (name: string) => (await api.post<{ data: ItemRequestDetail }>(`/api/item-requests/${id}/proxy`, { name })).data.data,
      meta: { successMessage: 'Representative code created. Send its QR to the person collecting.' }, onSuccess: done,
    }),
    cancel: useMutation({
      mutationFn: async () => (await api.delete<{ data: ItemRequestDetail }>(`/api/item-requests/${id}/proxy`)).data.data,
      meta: { successMessage: 'Representative cancelled.' }, onSuccess: done,
    }),
     /** data pekerja names to pick the representative from */
    people: async (q: string) => (await api.get<{ data: ProxyPerson[] }>(`/api/item-requests/${id}/proxy-people`, { params: { q } })).data.data,
  }
}

/** The same from the public status page (the track token is the requester's). */
export function usePublicRequestProxy(token: string) {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['public-request-status'] })
  return {
    create: useMutation({
      mutationFn: async (name: string) => (await api.post('/api/public/request-status/proxy', { token, name })).data,
      meta: { successMessage: 'Representative code created. Send its QR to the person collecting.' }, onSuccess: done,
    }),
    cancel: useMutation({
      mutationFn: async () => (await api.delete('/api/public/request-status/proxy', { params: { token } })).data,
      meta: { successMessage: 'Representative cancelled.' }, onSuccess: done,
    }),
     people: async (q: string) => (await api.get<{ data: ProxyPerson[] }>('/api/public/request-status/proxy-people', { params: { token, q } })).data.data,
  }
}

export function useCancelItemRequest(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => (await api.post<{ data: ItemRequestDetail }>(`/api/item-requests/${id}/cancel`)).data.data,
    meta: { successMessage: 'Request cancelled.' },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-requests'] }),
  })
}

// ---------------------------------------------------------------- share links

export interface ItemRequestLink {
  id: number
  token: string
  label: string | null
  is_active: boolean
  form_type: FormType
  form_label: string
  created_by: string | null
  created_at: string
  last_used_at: string | null
  requests_count: number
}

/** The public form's address for a link token (/form/request/:token). */
export const requestFormUrl = (token: string, base = window.location.origin) => `${base}/form/request/${token}`

/**
 * The address shared links start with: opened on the server itself (localhost) a link would only open
 * there, so the server gives its LAN address instead.
 */
export function useShareBase(): { base: string; localOnly: boolean } {
  const q = useQuery({
    queryKey: ['share-base'],
    staleTime: Infinity,
    queryFn: async () => (await api.get<{ data: { base: string; local_only: boolean } }>('/api/share-base')).data.data,
  })
  return { base: q.data?.base ?? window.location.origin, localOnly: q.data?.local_only ?? false }
}

export function useItemRequestLinks(enabled: boolean) {
  return useQuery({
    ...LIVE,
    queryKey: ['item-request-links'],
    enabled,
    queryFn: async () => (await api.get<{ data: ItemRequestLink[] }>('/api/item-request-links')).data.data,
  })
}

export function useItemRequestLinkMutations() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['item-request-links'] })
  return {
    create: useMutation({
      mutationFn: async (body: { label: string | null; form_type: FormType }) => (await api.post<{ data: ItemRequestLink }>('/api/item-request-links', body)).data.data,
      meta: { successMessage: false },
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: { id: number; is_active?: boolean; label?: string | null }) =>
        (await api.put<{ data: ItemRequestLink }>(`/api/item-request-links/${id}`, body)).data.data,
      meta: { successMessage: false },
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: number) => api.delete(`/api/item-request-links/${id}`),
      meta: { successMessage: 'Link deleted.' },
      onSuccess: refresh,
    }),
  }
}

// ---------------------------------------------------------------- public form (no account)

export function usePublicRequestForm(token: string) {
  return useQuery({
    queryKey: ['public-item-request', token],
    retry: false,
    queryFn: async () => (await api.get<{ data: { label: string | null; is_active: boolean; form: RequestForm } }>(`/api/public/item-request/${token}`)).data.data,
  })
}

/** The signed-in requester of the link form: their data from the account / data pekerja. */
export interface PublicRequester {
  name: string
  username: string
  contact: string | null
  divisi: string | null
  position: string | null
}

export function usePublicRequestLogin(token: string) {
  return useMutation({
    mutationFn: async (body: { username: string; password: string }) =>
      (await api.post<{ data: { session: string; profile: PublicRequester } }>(`/api/public/item-request/${token}/login`, body)).data.data,
    meta: { successMessage: false },
  })
}

export interface PublicRequestPayload extends ItemRequestCreatePayload {
  /** from usePublicRequestLogin: who sends it */
  session: string
  requester_contact?: string | null
  /** honeypot — hidden from people, bots fill it in */
  website?: string
  /** up to 3 images (data URLs) */
  images?: string[]
}

export function useSubmitPublicRequest(token: string) {
  return useMutation({
    mutationFn: async (body: PublicRequestPayload) =>
      (await api.post<{ data: { number: string; track_token: string } }>(`/api/public/item-request/${token}`, body)).data.data,
    meta: { successMessage: false },
    onSuccess: (d) => rememberTrack(d.track_token),
  })
}

// ---------------------------------------------------------------- Cek Permintaan (no account)

/** Pickup by a representative: who, until when; the code + QR text only for the requester. */
export interface RequestProxy {
  name: string
  expires_at: string
  code?: string
  qr?: string
}

export interface PublicRequestStatus {
  proxy?: RequestProxy | null
  can_proxy?: boolean
  token: string
  number: string
  form_label: string
  status: ItemRequestStatus
  status_label: string
  requester_name: string | null
  divisi: string | null
  needed_date: string | null
  created_at: string
  verify_note?: string | null
  /** past Manager + Direktur approval */
  approved?: boolean
  lines: {
    /** the item's own images (beside its name): GET public/request-status/image?token=&line=&slot= */
    id?: number; images?: string[]
    deskripsi_barang: string; qty: number; satuan: string | null; decision: LineDecision | null; reject_reason: string | null; short_reason?: string | null
    approved_qty?: number | string | null; fulfilled_qty?: number; line_status_label?: string
    /** what the requester typed; the Master Produk item it was verified as (null before verification / rejected) */
    asked?: string; item?: { code: string; name: string } | null
  }[]
  timeline: TimelineStep[]
  received_by: string | null
  /** images the requester attached (img1..img3) */
  images?: string[]
  /** goods prepared from stock: they can be picked up at the warehouse */
  ready_to_pick?: boolean
}

/** The page where a requester follows their requests: /cek-permintaan (all on this device) or /cek-permintaan/:token. */
export const trackUrl = (token?: string | null, base = window.location.origin) => `${base}/cek-permintaan${token ? `/${token}` : ''}`

const TRACK_KEY = 'stockwise.my-requests'

/** Track tokens of the requests sent from this device (newest first) — the "Permintaan saya" list. */
export function trackedTokens(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(TRACK_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string').slice(0, 30) : []
  } catch {
    return []
  }
}

export function rememberTrack(token: string) {
  try {
    localStorage.setItem(TRACK_KEY, JSON.stringify([token, ...trackedTokens().filter((t) => t !== token)].slice(0, 30)))
  } catch { /* private mode: the link still works */ }
}

/** The link form's sign-in of this tab (any link, still valid): its session and the requester's name. */
export function signedFormSession(): { session: string; name: string } | null {
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (!k?.startsWith('sw.request-form.')) continue
      const v = JSON.parse(sessionStorage.getItem(k) ?? 'null') as { session?: string; at?: number; profile?: { name?: string } } | null
      if (v?.session && Date.now() - (v.at ?? 0) < 3 * 3600_000) return { session: v.session, name: v.profile?.name ?? '' }
    }
  } catch { /* private mode */ }
  return null
}

/** All requests of the signed-in requester (sent from any device): their track tokens. */
export async function fetchMyRequestTokens(session: string) {
  return (await api.post<{ data: { tokens: string[]; name: string } }>('/api/public/request-status/mine', { session })).data.data
}

export function forgetTrack(token: string) {
  try {
    localStorage.setItem(TRACK_KEY, JSON.stringify(trackedTokens().filter((t) => t !== token)))
  } catch { /* ignore */ }
}

export function usePublicRequestStatus(tokens: string[]) {
  return useQuery({
    queryKey: ['public-request-status', tokens.join(',')],
    enabled: tokens.length > 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    queryFn: async () => (await api.get<{ data: PublicRequestStatus[] }>('/api/public/request-status', { params: { tokens: tokens.join(',') } })).data.data,
  })
}

/** Find one's requests on any device by the name typed in the form (whole name or first name). */
export function useLookupRequest() {
  return useMutation({
    mutationFn: async (name: string) => (await api.post<{ data: { tokens: string[] } }>('/api/public/request-status/lookup', { name })).data.data.tokens,
    meta: { silent: true }, // the page shows the error itself
    onSuccess: (tokens) => [...tokens].reverse().forEach(rememberTrack),
  })
}
