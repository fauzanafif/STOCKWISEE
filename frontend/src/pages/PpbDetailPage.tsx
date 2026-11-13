import { Link, useParams } from 'react-router-dom'
import { PpbReference } from '@/components/PpbReference'
import { usePpb, PPB_STATUS, PPB_LINE_STATUS, ppbDivisi } from '@/features/ppb/api'
import { PpbStatusBadges } from '@/components/PpbStatusBadges'
import { PrintDocButton } from '@/components/PrintDocButton'
import { DocText } from '@/components/DocLink'
import { BackLink } from '@/components/BackLink'
import { InBaseUom } from '@/components/UomEquivalent'
import { PpbApprovalCard, ppbActivity } from '@/components/PpbApproval'
import { DetailFallback } from '@/components/DetailFallback'
import { QtyProgress } from '@/components/QtyProgress'
import { Activity, DocPage, DocSection, MetaList, SyncNote } from '@/components/doc/DocLayout'
import { cn } from '@/lib/utils'
import { SmartButtons } from '@/components/documents/SmartButtons'
import { Chatter } from '@/components/documents/Chatter'

function fmtDate(v: string | null) {
  return v ? new Date(v).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '—'
}

export function PpbDetailPage() {
  const { id } = useParams()
  const ppbId = Number(id)
  const { data: ppb, isLoading } = usePpb(ppbId)

  if (isLoading || !ppb) return <div className="space-y-4"><BackLink to="/ppb" label="Purchase Request List" /><DetailFallback loading={isLoading} /></div>

  // the whole PPB document (all its lines); this page's line is highlighted
  const items = (ppb.document_items?.length ?? 0) > 1 ? ppb.document_items! : null
  const activity = ppbActivity(ppb)

  return (
    <DocPage
      chatter={<Chatter type="purchase_request" id={ppbId} />}
      back={{ to: '/ppb', label: 'Purchase Request List' }}
      kind="Purchase Request"
      number={ppb.no_ppb ?? '—'}
      status={<PpbStatusBadges ppb={ppb} />}
      subtitle={[fmtDate(ppb.tgl_ppb), ppbDivisi(ppb.divisi), ppb.peminta].filter((x) => x && x !== '—').join(' · ')}
      actions={<PrintDocButton url={`/api/ppb/${ppb.id}/print`} docType="ppb" />}
      aside={<>
        <DocSection title="Information">
          <MetaList items={[
            { label: 'Purchase Request Date', value: fmtDate(ppb.tgl_ppb) },
            { label: 'Division', value: ppbDivisi(ppb.divisi) },
            { label: 'Requester', value: ppb.peminta },
            { label: 'Item status', value: [ppb.is_amend ? 'Amend' : null, ppb.line_status ? PPB_LINE_STATUS[ppb.line_status]?.label ?? ppb.line_status : null].filter(Boolean).join(' + ') || null },
            { label: 'Documents in Accurate', value: ppb.status ? PPB_STATUS[ppb.status]?.label ?? ppb.status : null },
          ]} />
          <div className="mt-3 border-t pt-3"><PpbStatusBadges ppb={ppb} withHint /></div>
        </DocSection>
        {activity.length > 0 && <DocSection title="Activity"><Activity items={activity} /></DocSection>}
        <SyncNote at={ppb.accurate_synced_at} />
      </>}
    >
      <SmartButtons type="purchase_request" id={ppbId} />
      <PpbApprovalCard ppb={ppb} />

      <DocSection title="Item">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-base font-medium leading-snug">{ppb.deskripsi_barang ?? '—'}</div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">{ppb.kode_barang ?? '—'}</div>
          </div>
          <dl className="grid shrink-0 grid-cols-3 gap-4 text-right sm:gap-6">
            <div><dt className="text-xs text-muted-foreground">Requested</dt><dd className="text-lg font-semibold tabular-nums">{ppb.kuantitas ?? '—'} <span className="text-xs font-normal text-muted-foreground">{ppb.satuan ?? ''}</span><InBaseUom qty={ppb.kuantitas} ratio={ppb.unit_ratio} base={ppb.base_satuan} /></dd></div>
            <div><dt className="text-xs text-muted-foreground">Ordered</dt><dd className="text-lg font-semibold tabular-nums">{ppb.qty_dipesan ?? 0}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Received</dt><dd className="text-lg font-semibold tabular-nums">{ppb.qty_diterima ?? 0}</dd></div>
          </dl>
        </div>
        <div className="mt-4 space-y-3 border-t pt-3">
          <div>
            <div className="text-xs text-muted-foreground">Remarks</div>
            <div className="mt-0.5 whitespace-pre-wrap"><DocText text={ppb.keterangan} /></div>
          </div>
          {ppb.catatan_baris && (
            <div>
              <div className="text-xs text-muted-foreground">Row notes</div>
              <div className="mt-0.5 whitespace-pre-wrap">{ppb.catatan_baris}</div>
            </div>
          )}
        </div>
      </DocSection>

      {/* the approval covers every line of the document: all of them, this one marked */}
      {items && (
        <DocSection title="Purchase Request document content" count={items.length} flush>
          <ul className="divide-y">
            {items.map((it, i) => (
              <li key={it.id} className={cn('flex items-start gap-3 px-4 py-2.5', it.id === ppb.id && 'bg-primary/5')}>
                <span className="w-5 shrink-0 pt-0.5 text-right text-xs text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  {it.id === ppb.id || !it.id ? <span className="block">{it.deskripsi_barang ?? '-'}</span>
                    : <Link to={`/ppb/${it.id}`} className="block hover:text-primary hover:underline">{it.deskripsi_barang ?? '-'}</Link>}
                  <span className="block text-xs text-muted-foreground">
                    <span className="">{it.kode_barang ?? '-'}</span>{it.peminta ? ` · ${it.peminta}` : ''}{it.catatan_baris ? ` · ${it.catatan_baris}` : ''}
                  </span>
                </span>
                <span className="hidden shrink-0 sm:block"><PpbReference r={it.reference} /></span>
                <span className="shrink-0 whitespace-nowrap font-medium tabular-nums">{it.kuantitas ?? '-'} {it.satuan ?? ''}</span>
              </li>
            ))}
          </ul>
        </DocSection>
      )}

      {(ppb.purchased_via?.length ?? 0) > 0 && (
        <DocSection title="Ordered via PO" count={ppb.purchased_via!.length} flush>
          <ul className="divide-y">
            {ppb.purchased_via!.map((p) => (
              <li key={p.purchase_order_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <Link to={`/purchase-orders/${p.purchase_order_id}`} className=" text-primary hover:underline">{p.number ?? '—'}</Link>
                <QtyProgress total={p.qty} done={p.qty_received} className="w-28" />
              </li>
            ))}
          </ul>
        </DocSection>
      )}
    </DocPage>
  )
}
