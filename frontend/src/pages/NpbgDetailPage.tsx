import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { lokasiText, useDecideNpbg, useResubmitNpbg, useNpbg, useUpdateNpbg } from '@/features/npbg/api'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { NpbgVerificationPanel } from '@/components/NpbgVerificationPanel'
import { KembaliBekasToggle } from '@/components/KembaliBekasToggle'
import { PrintDocButton } from '@/components/PrintDocButton'
import type { Npbg, NpbgEditableFields } from '@/features/npbg/api'
import { DocText } from '@/components/DocLink'
import { BackLink } from '@/components/BackLink'
import { InBaseUom } from '@/components/UomEquivalent'
import { DetailFallback } from '@/components/DetailFallback'
import { BYPASS_TEXT, isAutoApproval } from '@/lib/approval'
import { ResubmitPanel } from '@/components/approval/ResubmitPanel'
import { invalidTo } from '@/lib/notify'
import { Badge } from '@/components/ui/badge'
import { Activity, DocPage, DocSection, FieldGrid, MetaList, SyncNote, TONE_EDGE, type ActivityItem } from '@/components/doc/DocLayout'
import { SmartButtons } from '@/components/documents/SmartButtons'
import { Chatter } from '@/components/documents/Chatter'

function fmtDate(v: string | null) {
  return v ? new Date(v).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '—'
}

function EditForm({ npbg, onDone }: { npbg: Npbg; onDone: () => void }) {
  const update = useUpdateNpbg(npbg.id)
  const [form, setForm] = useState<NpbgEditableFields>({
    tipe_npbg: npbg.tipe_npbg,
    deskripsi: npbg.deskripsi,
    nama_proyek: npbg.nama_proyek,
    dikeluarkan_oleh: npbg.dikeluarkan_oleh,
  })
  const [err, setErr] = useState<string | null>(null)

  const set = (k: keyof NpbgEditableFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value || null }))

  return (
    <Card className={TONE_EDGE.info}>
      <CardContent className="space-y-3 p-4">
        <div>
          <div className="font-medium">Edit Delivery Order</div>
          <p className="text-xs text-muted-foreground">Other fields follow Accurate.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Tipe NPBG follows Accurate's Terms; only a manual NPBG sets its own */}
          {npbg.is_manual && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Delivery Order Type</label>
              <Select value={form.tipe_npbg ?? ''} onChange={(e) => setForm((f) => ({ ...f, tipe_npbg: e.target.value || null }))}>
                <option value="">—</option>
                <option value="Penjualan">Penjualan</option>
                <option value="Non Penjualan">Non Penjualan</option>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Project Name</label>
            <Input value={form.nama_proyek ?? ''} onChange={set('nama_proyek')} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Issued By</label>
            <Input value={form.dikeluarkan_oleh ?? ''} onChange={set('dikeluarkan_oleh')} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs text-muted-foreground">Description</label>
            <Input value={form.deskripsi ?? ''} onChange={set('deskripsi')} />
          </div>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onDone}>Cancel</Button>
          <Button
            size="sm"
            disabled={update.isPending}
            onClick={() => update.mutate(form, { onSuccess: onDone, onError: (e) => setErr(apiErrorMessage(e)) })}
          >
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function NpbgDetailPage() {
  const { id } = useParams()
  const npbgId = Number(id)
  const { hasPermission } = useAuth()
  const { data: npbg, isLoading } = useNpbg(npbgId)
  const [editing, setEditing] = useState(false)

  useEffect(() => setEditing(false), [npbgId])

  if (isLoading || !npbg) return <div className="space-y-4"><BackLink to="/npbg" label="Delivery Order List" /><DetailFallback loading={isLoading} /></div>

  const activity: ActivityItem[] = (npbg.approval_log ?? []).map((l) => {
    const auto = l.action === 'APPROVE_MANAGER' && isAutoApproval(l.note)
    return {
      id: l.id, label: auto ? BYPASS_TEXT : NPBG_LOG[l.action] ?? l.action, who: auto ? null : l.user_name, at: l.created_at,
      note: isAutoApproval(l.note) ? null : l.note,
      tone: l.action === 'REJECT' ? 'bad' : l.action === 'RETURN' ? 'warn' : l.action === 'DIAJUKAN_ULANG' ? 'wait' : auto ? 'info' : 'ok',
    }
  })

  return (
    <DocPage
      chatter={<Chatter type="delivery_order" id={npbgId} />}
      back={{ to: '/npbg', label: 'Delivery Order List' }}
      kind="Delivery Order"
      number={npbg.no_npbg ?? '—'}
      status={<>
        {npbg.approval && <Badge variant={NPBG_APPROVAL[npbg.approval.status]?.variant ?? 'neutral'}>{NPBG_APPROVAL[npbg.approval.status]?.short ?? npbg.approval.status}</Badge>}
        {npbg.tipe_npbg && <Badge variant="neutral">{npbg.tipe_npbg}</Badge>}
        {npbg.is_manual && <Badge variant="neutral">STOCKWISE</Badge>}
      </>}
      subtitle={[fmtDate(npbg.tgl_npbg), npbg.pelanggan, npbg.nama_proyek].filter((x) => x && x !== '—').join(' · ')}
      actions={<>
        {hasPermission('npbg.update') && !editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>
        )}
        <PrintDocButton url={`/api/npbg/${npbg.id}/print`} docType="npbg" />
      </>}
      aside={<>
        <DocSection title="Information">
          <MetaList items={[
            { label: 'Delivery Order Date', value: fmtDate(npbg.tgl_npbg) },
            { label: 'Shipdate', value: fmtDate(npbg.shipdate) },
            { label: 'Taxdate', value: fmtDate(npbg.taxdate) },
            { label: 'Delivery Order Type', value: npbg.tipe_npbg },
            { label: 'Classification', value: npbg.klasifikasi },
            { label: 'Division', value: npbg.divisi },
            { label: 'Customer', value: npbg.pelanggan },
            { label: 'Project name', value: npbg.nama_proyek },
            { label: 'Issued by', value: npbg.dikeluarkan_oleh },
          ]} />
        </DocSection>
        {activity.length > 0 && <DocSection title="Activity"><Activity items={activity} /></DocSection>}
        <SyncNote at={npbg.accurate_synced_at} manual={!npbg.accurate_synced_at && !!npbg.is_manual} />
      </>}
    >
      <SmartButtons type="delivery_order" id={npbgId} />
      {editing && <EditForm npbg={npbg} onDone={() => setEditing(false)} />}
      {npbg.approval && <NpbgApprovalCard npbg={npbg} />}

      <DocSection title="Items out">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-base font-medium leading-snug">{npbg.deskripsi_barang ?? '—'}</div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">{npbg.kode_barang ?? '—'}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xs text-muted-foreground">Quantity</div>
            <div className="text-lg font-semibold tabular-nums">{npbg.kuantitas ?? '—'} <span className="text-xs font-normal text-muted-foreground">{npbg.satuan ?? ''}</span><InBaseUom qty={npbg.kuantitas} ratio={npbg.unit_ratio} base={npbg.base_satuan} /></div>
          </div>
        </div>
        <div className="mt-4 border-t pt-3">
          <FieldGrid items={[
            { label: 'Requester', value: npbg.peminta },
            { label: 'Serial No.', value: npbg.no_seri },
            { label: 'Warehouse location / rack', value: lokasiText(npbg) },
            { label: 'Description', value: npbg.deskripsi, wide: true },
            { label: 'Remarks', value: <span className="whitespace-pre-wrap"><DocText text={npbg.keterangan} /></span>, wide: true },
          ]} />
        </div>
        <div className="mt-4 rounded-md border bg-muted/30 px-3 py-2" title="Tick if the used item must be returned to the warehouse (goes into Used Item Return Tracking until its return Receipt is recorded)">
          <KembaliBekasToggle npbg={npbg} showLink />
        </div>
      </DocSection>

      <div className="rounded-lg border bg-card p-4"><NpbgVerificationPanel npbgId={npbg.id} /></div>
    </DocPage>
  )
}

const NPBG_APPROVAL: Record<string, { label: string; short: string; cls: string; variant: 'warning' | 'success' | 'danger' | 'neutral' }> = {
  MENUNGGU: { label: 'Waiting for Manager approval', short: 'Waiting for Manager', cls: TONE_EDGE.wait, variant: 'warning' },
  MENUNGGU_DIREKTUR: { label: 'Waiting for Director approval', short: 'Waiting for Director', cls: TONE_EDGE.wait, variant: 'warning' },
  DISETUJUI: { label: 'Approved — items issued from stock', short: 'Approved', cls: TONE_EDGE.ok, variant: 'success' },
  DITOLAK: { label: 'Rejected', short: 'Rejected', cls: TONE_EDGE.bad, variant: 'danger' },
  DIKEMBALIKAN: { label: 'Returned for revision', short: 'Needs revision', cls: TONE_EDGE.warn, variant: 'warning' },
}
const NPBG_LOG: Record<string, string> = {
  APPROVE_MANAGER: 'Approved by Manager', APPROVE: 'Approved by Director', REJECT: 'Rejected',
  RETURN: 'Returned for revision', DIAJUKAN_ULANG: 'Resubmitted (revised)',
}

/** Manual NPBG: Manager → Direktur approve it before the goods leave the stock. */
function NpbgApprovalCard({ npbg }: { npbg: Npbg }) {
  const decide = useDecideNpbg(npbg.id)
  const resubmit = useResubmitNpbg(npbg.id)
  // reject, or send back to admin for a revision: both need a note
  const [rejecting, setRejecting] = useState<false | 'REJECT' | 'RETURN'>(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const a = npbg.approval!
  const meta = NPBG_APPROVAL[a.status]
  const run = (action: 'APPROVE' | 'REJECT' | 'RETURN') => {
    setErr(null)
    if (action !== 'APPROVE' && !note.trim()) return invalidTo(setErr, action === 'REJECT' ? 'The rejection reason is required.' : 'A note is required: write why it is revised.')
    decide.mutate({ action, note: note.trim() || null }, {
      onSuccess: () => { setRejecting(false); setNote('') }, onError: (e) => setErr(apiErrorMessage(e)),
    })
  }
  return (
    <Card className={meta?.cls}>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-medium">{meta?.label ?? a.status}</div>
          </div>
          {npbg.can_decide && !rejecting && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50" disabled={decide.isPending} onClick={() => setRejecting('RETURN')}>Revise</Button>
              <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => setRejecting('REJECT')}>Reject</Button>
              <Button size="sm" disabled={decide.isPending} onClick={() => run('APPROVE')}>Approve ({a.step === 'DIREKTUR' ? 'Director' : 'Manager'})</Button>
            </div>
          )}
        </div>
        {rejecting && (
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-0 flex-1" autoFocus maxLength={1000} placeholder={rejecting === 'RETURN' ? 'Why revise? What needs changing? (required)' : 'Rejection reason (required)'} value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" variant="outline" onClick={() => setRejecting(false)}>Cancel</Button>
            {rejecting === 'RETURN'
              ? <Button size="sm" className="bg-orange-600 hover:bg-orange-700" disabled={decide.isPending} onClick={() => run('RETURN')}>Send revision to admin</Button>
              : <Button size="sm" disabled={decide.isPending} onClick={() => run('REJECT')}>Reject Delivery Order</Button>}
          </div>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
        {a.status === 'DIKEMBALIKAN' && (
          <ResubmitPanel reason={a.note} by={a.by} canResubmit={!!npbg.can_resubmit} busy={resubmit.isPending}
            rows={[{ id: npbg.id, label: npbg.deskripsi_barang ?? '-', code: npbg.kode_barang, qty: Number(npbg.kuantitas), unit: npbg.satuan }]}
            onResubmit={(quantities, n) => resubmit.mutate({ quantities: Object.keys(quantities).length ? quantities : undefined, note: n })} />
        )}
      </CardContent>
    </Card>
  )
}
