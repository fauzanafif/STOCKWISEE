import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

/**
 * Odoo-style collaboration on a transaction document: Smart Buttons (related documents), Chatter (messages,
 * internal notes, tracked changes), Activities and Audit. A document is its type + the id its page opens with.
 */
export type DocType = 'item_request' | 'delivery_order' | 'ppb_draft' | 'purchase_request' | 'purchase_order' | 'receipt' | 'purchase_return'

/** The page each document type opens on. */
export const DOC_PATH: Record<DocType, (id: number) => string> = {
  item_request: (id) => `/item-requests/${id}`,
  delivery_order: (id) => `/npbg/${id}`,
  ppb_draft: (id) => `/ppb/drafts/${id}`,
  purchase_request: (id) => `/ppb/${id}`,
  purchase_order: (id) => `/purchase-orders/${id}`,
  receipt: (id) => `/ri/${id}`,
  purchase_return: (id) => `/purchase-returns/${id}`,
}

export interface RelatedDoc { type: DocType; id: number; number: string; status: string | null; date: string | null; party: string | null }
export interface RelatedGroup { type: DocType; label: string; count: number; docs: RelatedDoc[] }
export interface Related { document: { type: DocType; key: string; id: number; number: string; label: string }; groups: RelatedGroup[]; counts: { messages: number; activities: number } }

export interface FeedAttachment { id: number; name: string; mime: string | null; size: number }
export type FeedItem =
  | { id: string; kind: 'MESSAGE' | 'NOTE'; message_id: number; at: string | null; user_id: number | null; user_name: string | null; body: string | null; deleted: boolean; edited: boolean; can_edit: boolean; attachments: FeedAttachment[] }
  | { id: string; kind: 'TRACKING'; at: string | null; user_name: string | null; event: string; model: string; changes: Record<string, [unknown, unknown]>; reason: string | null }

export interface SystemActivity { summary: string; responsible: string; for_you: boolean; since: string | null }
export interface DocActivity {
  id: number; activity_type: string; type_label: string; summary: string; note: string | null; assignee_id: number; assignee_name: string | null
  created_by_name: string | null; due_date: string | null; state: 'PLANNED' | 'TODAY' | 'OVERDUE' | 'DONE' | 'CANCELLED'
  done_at: string | null; done_by_name: string | null; done_note: string | null; created_at: string | null; can_complete: boolean; can_cancel: boolean
}
export interface Activities { system: SystemActivity[]; manual: DocActivity[]; types: Record<string, string>; can_schedule: boolean }

export interface AuditRow { id: number; at: string | null; user_name: string | null; event: string; model: string; model_id: number | null; changes: Record<string, [unknown, unknown]>; reason: string | null; ip: string | null }

const base = (type: DocType, id: number) => `/api/documents/${type}/${id}`
const key = (type: DocType, id: number) => ['documents', type, id]

export function useRelated(type: DocType, id: number) {
  return useQuery({ queryKey: [...key(type, id), 'related'], enabled: id > 0, queryFn: async () => (await api.get<{ data: Related }>(`${base(type, id)}/related`)).data.data })
}

export function useFeed(type: DocType, id: number) {
  return useQuery({
    queryKey: [...key(type, id), 'feed'], enabled: id > 0,
    queryFn: async () => (await api.get<{ data: FeedItem[]; meta: { staff: boolean } }>(`${base(type, id)}/feed`)).data,
  })
}

export function useDocActivities(type: DocType, id: number) {
  return useQuery({ queryKey: [...key(type, id), 'activities'], enabled: id > 0, queryFn: async () => (await api.get<{ data: Activities }>(`${base(type, id)}/activities`)).data.data })
}

export function useAssignees(type: DocType, id: number, enabled: boolean) {
  return useQuery({
    queryKey: [...key(type, id), 'assignees'], enabled: enabled && id > 0,
    queryFn: async () => (await api.get<{ data: { id: number; name: string }[] }>(`${base(type, id)}/assignees`)).data.data,
  })
}

export function useAudit(type: DocType, id: number, enabled: boolean) {
  return useQuery({ queryKey: [...key(type, id), 'audit'], enabled: enabled && id > 0, queryFn: async () => (await api.get<{ data: AuditRow[] }>(`${base(type, id)}/audit`, { params: { per_page: 200 } })).data.data })
}

export function useDocMutations(type: DocType, id: number) {
  const qc = useQueryClient()
  const onSuccess = () => qc.invalidateQueries({ queryKey: key(type, id) })
  return {
    post: useMutation({
      mutationFn: async ({ kind, body, files }: { kind: 'MESSAGE' | 'NOTE'; body: string; files: File[] }) => {
        const form = new FormData()
        form.append('kind', kind)
        form.append('body', body)
        files.forEach((f) => form.append('files[]', f))
        return (await api.post(`${base(type, id)}/messages`, form)).data
      },
      onSuccess,
    }),
    edit: useMutation({ mutationFn: async ({ messageId, body }: { messageId: number; body: string }) => (await api.put(`${base(type, id)}/messages/${messageId}`, { body })).data, onSuccess }),
    remove: useMutation({ mutationFn: async (messageId: number) => (await api.delete(`${base(type, id)}/messages/${messageId}`)).data, onSuccess }),
    schedule: useMutation({
      mutationFn: async (data: { activity_type: string; summary: string | null; note: string | null; assignee_id: number; due_date: string }) => (await api.post(`${base(type, id)}/activities`, data)).data,
      onSuccess,
    }),
    done: useMutation({ mutationFn: async ({ activityId, note }: { activityId: number; note: string | null }) => (await api.post(`${base(type, id)}/activities/${activityId}/done`, { note })).data, onSuccess }),
    cancel: useMutation({ mutationFn: async (activityId: number) => (await api.post(`${base(type, id)}/activities/${activityId}/cancel`)).data, onSuccess }),
  }
}

/** Saves an attachment, fetched with the session. */
export async function downloadAttachment(type: DocType, id: number, a: FeedAttachment) {
  const res = await api.get(`${base(type, id)}/attachments/${a.id}`, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data as Blob)
  const link = document.createElement('a')
  link.href = url
  link.download = a.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** A tracked field name as people read it. */
export const FIELD_LABEL: Record<string, string> = {
  status: 'Status', line_status: 'Line status', qty: 'Quantity', kuantitas: 'Quantity', approved_qty: 'Approved qty', handed_qty: 'Handed over qty',
  urgency: 'Urgency', needed_date: 'Needed date', vendor_id: 'Vendor', harga_satuan: 'Unit price', unit_price: 'Unit price', item_id: 'Item',
  deskripsi_barang: 'Description', kode_barang: 'Item code', satuan: 'Unit', note: 'Note', keterangan: 'Remarks', expected_date: 'Expected date',
  no_npbg: 'Delivery Order No.', no_ppb: 'Purchase Request No.', no_po: 'PO No.', no_ri: 'Receipt No.', divisi: 'Division', peminta: 'Requester',
}

export const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Created', UPDATED: 'Changed', DELETED: 'Removed', MESSAGE_EDITED: 'Message edited', MESSAGE_DELETED: 'Message deleted',
  ACTIVITY_SCHEDULED: 'Activity scheduled', ACTIVITY_DONE: 'Activity done', ACTIVITY_CANCELLED: 'Activity cancelled',
}

export const fmtWhen = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '-')
export const showValue = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))
