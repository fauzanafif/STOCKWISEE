import { Link, useParams } from 'react-router-dom'
import { FileText, Undo2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { RI_SOURCE, useRi, useRiPhoto, riJenis } from '@/features/ri/api'
import { lokasiText } from '@/features/npbg/api'
import { PrintDocButton } from '@/components/PrintDocButton'
import { RiSerialList } from '@/components/RiSerialEntry'
import { Badge } from '@/components/ui/badge'
import { DocPage, DocSection, FieldGrid, MetaList, SyncNote } from '@/components/doc/DocLayout'
import { DocText } from '@/components/DocLink'
import { BackLink } from '@/components/BackLink'
import { DetailFallback } from '@/components/DetailFallback'
import { openImage, showUrl } from '@/components/ui/lightbox'

function fmtDate(v: string | null) {
  return v ? new Date(v).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '—'
}

function fmtMoney(v: number | null) {
  return v != null ? `Rp ${v.toLocaleString('id-ID')}` : '—'
}

/** What a line received in another unit made in stock ("= 30 PCS in stock"). */
function inStock(l: { kuantitas: number | null; unit_ratio?: number; base_satuan?: string | null }) {
  if (!l.base_satuan || l.kuantitas == null) return null
  return `= ${(Math.round(Number(l.kuantitas) * Number(l.unit_ratio ?? 1) * 100) / 100).toLocaleString('id-ID')} ${l.base_satuan} in stock`
}

export function RiDetailPage() {
  const { id } = useParams()
  const riId = Number(id)
  const { data: ri, isLoading } = useRi(riId)
  const { hasPermission } = useAuth()

  if (isLoading || !ri) return <div className="space-y-4"><BackLink to="/ri" label="Receipt List" /><DetailFallback loading={isLoading} /></div>

  const many = (ri.lines?.length ?? 0) > 1
  const poLink = ri.source_po
    ? <Link to={`/purchase-orders/${ri.source_po.purchase_order_id}`} className=" text-primary hover:underline">{ri.source_po.number ?? ri.no_po ?? '—'}</Link>
    : ri.no_po ?? null

  return (
    <DocPage
      back={{ to: '/ri', label: 'Receipt List' }}
      kind="Receipt"
      number={ri.no_ri ?? '—'}
      status={<>
        {ri.sumber && <Badge variant="neutral">{RI_SOURCE[ri.sumber]}</Badge>}
        <Badge variant="default">{riJenis(ri.divisi)}</Badge>
      </>}
      subtitle={[fmtDate(ri.tgl_ri), ri.vendor].filter((x) => x && x !== '—').join(' · ')}
      actions={<>
        {hasPermission('purchase_return.manage') && ri.no_ri && (
          <Button asChild size="sm" variant="outline"><Link to={`/purchase-returns/new?ri=${encodeURIComponent(ri.no_ri)}`}><Undo2 className="size-4" /> Return items</Link></Button>
        )}
        <PrintDocButton url={`/api/ri/${ri.id}/print`} docType="ri" />
      </>}
      aside={<>
        <DocSection title="Receiving">
          <MetaList items={[
            { label: 'Receipt Date', value: fmtDate(ri.tgl_ri) },
            { label: 'Receipt type', value: riJenis(ri.divisi) },
            { label: 'Source', value: ri.sumber ? RI_SOURCE[ri.sumber] : null },
            { label: 'Vendor', value: ri.vendor },
            { label: 'PO No', value: poLink },
            { label: 'Inspector', value: ri.pemeriksa },
            { label: 'Location', value: lokasiText(ri) },
          ]} />
        </DocSection>
        <DocSection title="Shipping">
          <MetaList items={[
            { label: 'Shipping date', value: fmtDate(ri.shipdate) },
            { label: 'Delivery note no.', value: ri.no_surat_jalan ?? null },
            { label: 'Sender', value: ri.pengirim ?? null },
            { label: 'FOB', value: ri.fob ?? null },
          ]} />
        </DocSection>
        <SyncNote at={ri.accurate_synced_at} />
      </>}
    >
      {many ? (
        // an RI of several items (e.g. from a PO): every line of it, this one marked
        <DocSection title="Items received" count={ri.lines!.length} flush>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="whitespace-nowrap border-b bg-muted/50 text-left">
                <tr><th className="px-4 py-2.5">Item</th><th className="px-3 py-2.5 text-right">Quantity</th><th className="px-3 py-2.5 text-right">Price</th><th className="px-3 py-2.5">Serial No.</th><th className="px-3 py-2.5">Purchase Request</th><th className="px-3 py-2.5">Photo</th></tr>
              </thead>
              <tbody className="divide-y">
                {ri.lines!.map((l) => (
                  <tr key={l.id} className={l.id === ri.id ? 'bg-primary/5' : undefined}>
                    <td className="px-4 py-2.5"><div className="font-medium">{l.deskripsi_barang}</div><div className="text-[13px] text-muted-foreground">{l.kode_barang ?? ''}</div></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{l.kuantitas ?? ''} {l.satuan ?? ''}{inStock(l) && <div className="text-xs text-muted-foreground">{inStock(l)}</div>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{fmtMoney(l.harga_satuan)}</td>
                    <td className="px-3 py-2.5"><RiSerialList riId={ri.id} text={l.no_seri} item={l.deskripsi_barang} /></td>
                    <td className="px-3 py-2.5 text-[13px]">{l.no_ppb ?? ''}</td>
                    <td className="px-3 py-2.5"><div className="flex gap-1.5">{(l.photos ?? []).map((slot) => <div key={slot} className="w-12"><RiPhoto id={l.id} slot={slot} /></div>)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DocSection>
      ) : (
        <DocSection title="Items received">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-base font-medium leading-snug">{ri.deskripsi_barang ?? '—'}</div>
              <div className="mt-0.5 text-[13px] text-muted-foreground">{ri.kode_barang ?? '—'}</div>
            </div>
            <dl className="grid shrink-0 grid-cols-2 gap-6 text-right">
              <div><dt className="text-xs text-muted-foreground">Quantity</dt><dd className="text-lg font-semibold tabular-nums">{ri.kuantitas ?? '—'} <span className="text-xs font-normal text-muted-foreground">{ri.satuan ?? ''}</span>{inStock(ri) && <div className="text-xs font-normal text-muted-foreground">{inStock(ri)}</div>}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Unit price</dt><dd className="text-lg font-semibold tabular-nums">{fmtMoney(ri.harga_satuan)}</dd></div>
            </dl>
          </div>
          <div className="mt-4 border-t pt-3">
            <FieldGrid items={[
              { label: 'Purchase Request No.', value: ri.no_ppb ?? null },
              { label: 'Serial No.', value: ri.no_seri ? <RiSerialList riId={ri.id} text={ri.no_seri} item={ri.deskripsi_barang} /> : null },
              { label: 'Warehouse location / rack', value: lokasiText(ri) },
            ]} />
          </div>
        </DocSection>
      )}

      <DocSection title="Remarks">
        <div className="whitespace-pre-wrap"><DocText text={ri.keterangan} /></div>
      </DocSection>

      {((ri.photos?.length ?? 0) > 0 || (ri.documents?.length ?? 0) > 0) && (
        <DocSection title="Receipt proof">
          <div className="space-y-3">
            {(ri.documents?.length ?? 0) > 0 && (
              <div>
                <div className="mb-1.5 text-xs text-muted-foreground">Document (delivery note / invoice)</div>
                <div className="flex flex-wrap gap-2">
                  {ri.documents!.map((d) => <RiDocument key={d.slot} id={ri.id} slot={d.slot} name={d.file_name ?? d.slot} />)}
                </div>
              </div>
            )}
            {(ri.photos?.length ?? 0) > 0 && (
              <div>
                <div className="mb-1.5 text-xs text-muted-foreground">Photo</div>
                <div className="grid max-w-xl grid-cols-3 gap-2">
                  {ri.photos!.map((slot) => <RiPhoto key={slot} id={ri.id} slot={slot} />)}
                </div>
              </div>
            )}
          </div>
        </DocSection>
      )}
    </DocPage>
  )
}

/** One document of the RI (photo or PDF), opened in a new tab. */
function RiDocument({ id, slot, name }: { id: number; slot: string; name: string }) {
  const { data: url } = useRiPhoto(id, slot)
  return (
    <button type="button" onClick={() => void showUrl(url, { alt: name, name })} disabled={!url}
      className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs text-primary hover:bg-muted">
      <FileText className="size-3.5" /> {name}
    </button>
  )
}

function RiPhoto({ id, slot }: { id: number; slot: string }) {
  const { data: url } = useRiPhoto(id, slot)
  return (
    <button type="button" onClick={() => url && openImage({ src: url, alt: `Proof photo ${slot.replace('foto', '')}` })} className="block w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted" title="View photo">
      {url ? <img src={url} alt={`Proof photo ${slot.replace('foto', '')}`} className="aspect-square w-full object-cover" /> : <div className="aspect-square" />}
    </button>
  )
}
