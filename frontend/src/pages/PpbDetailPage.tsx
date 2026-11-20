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
  const fromAccurate = !!ppb.accurate_synced_at

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
            // a STOCKWISE Purchase Request has no Accurate document status
            ...(fromAccurate ? [{ label: 'Documents in Accurate', value: ppb.status ? PPB_STATUS[ppb.status]?.label ?? ppb.status : null }] : []),
            ...(ppb.keterangan ? [{ label: 'Remarks', value: <span className="whitespace-pre-wrap"><DocText text={ppb.keterangan} /></span> }] : []),
          ]} />
        </DocSection>
        {activity.length > 0 && <DocSection title="Activity"><Activity items={activity} /></DocSection>}
        <SyncNote at={ppb.accurate_synced_at} />
      </>}
    >
      <SmartButtons type="purchase_request" id={ppbId} />
      <PpbApprovalCard ppb={ppb} />

      {items ? (
        // the approval covers every line of the document: one list of all of them, this one marked
        <DocSection title="Items" count={items.length} flush>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="whitespace-nowrap border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 px-4 py-2 text-right font-medium">#</th><th className="px-3 py-2 font-medium">Item</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Source</th><th className="px-4 py-2 text-right font-medium">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((it, i) => {
                  const here = it.id === ppb.id
                  return (
                    <tr key={it.id ?? i} className={cn(here && 'bg-primary/5')}>
                      <td className="px-4 py-2.5 text-right align-top text-xs text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        {here || !it.id ? <span className={cn('block', here && 'font-medium')}>{it.deskripsi_barang ?? '-'}</span>
                          : <Link to={`/ppb/${it.id}`} className="block hover:text-primary hover:underline">{it.deskripsi_barang ?? '-'}</Link>}
                        <span className="block text-xs text-muted-foreground">{it.kode_barang ?? '-'}{it.catatan_baris ? ` · ${it.catatan_baris}` : ''}</span>
                        {here && (
                          <span className="mt-1 block text-xs text-muted-foreground">Ordered {ppb.qty_dipesan ?? 0} · Received {ppb.qty_diterima ?? 0}</span>
                        )}
                      </td>
                      <td className="hidden px-3 py-2.5 align-top md:table-cell">{it.reference ? <PpbReference r={it.reference} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right align-top font-medium tabular-nums">
                        {it.kuantitas ?? '-'} <span className="text-xs font-normal text-muted-foreground">{it.satuan ?? ''}</span>
                        {here && <InBaseUom qty={ppb.kuantitas} ratio={ppb.unit_ratio} base={ppb.base_satuan} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </DocSection>
      ) : (
        <DocSection title="Item">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-base font-medium leading-snug">{ppb.deskripsi_barang ?? '—'}</div>
              <div className="mt-0.5 text-[13px] text-muted-foreground">{ppb.kode_barang ?? '—'}{ppb.catatan_baris ? ` · ${ppb.catatan_baris}` : ''}</div>
            </div>
            <dl className="grid shrink-0 grid-cols-3 gap-4 text-right sm:gap-6">
              <div><dt className="text-xs text-muted-foreground">Requested</dt><dd className="text-lg font-semibold tabular-nums">{ppb.kuantitas ?? '—'} <span className="text-xs font-normal text-muted-foreground">{ppb.satuan ?? ''}</span><InBaseUom qty={ppb.kuantitas} ratio={ppb.unit_ratio} base={ppb.base_satuan} /></dd></div>
              <div><dt className="text-xs text-muted-foreground">Ordered</dt><dd className="text-lg font-semibold tabular-nums">{ppb.qty_dipesan ?? 0}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Received</dt><dd className="text-lg font-semibold tabular-nums">{ppb.qty_diterima ?? 0}</dd></div>
            </dl>
          </div>
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
