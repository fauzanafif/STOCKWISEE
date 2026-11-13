import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Ban, Loader2, Plus, Save, Send, Trash2 } from 'lucide-react'
import { apiErrorMessage } from '@/lib/api'
import { DRAFT_STATUS, useDraftActions, useDraftLineActions, useDraftLines, usePpbDraft, usePpbDrafts, useSavedDraftActions, useSavedDrafts, type DraftLineRow, type PpbDraftLine, type SavedDraft } from '@/features/ppbDrafts/api'
import type { ItemLookupResult } from '@/features/inventory/api'
import { BackLink } from '@/components/BackLink'
import { DataTable, type Column } from '@/components/DataTable'
import { DetailFallback } from '@/components/DetailFallback'
import { ItemPicker } from '@/components/ItemPicker'
import { PageHeader } from '@/components/PageHeader'
import { useInfiniteRows } from '@/components/InfiniteRows'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { confirmDialog } from '@/components/ui/confirm'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { invalidTo, toast } from '@/lib/notify'
import { SmartButtons } from '@/components/documents/SmartButtons'
import { Chatter } from '@/components/documents/Chatter'
import { ChatterLayout } from '@/components/doc/DocLayout'

const fmtDateTime = (v: string | null) => (v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-')
const fmtQty = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('id-ID', { maximumFractionDigits: 2 }))
const today = () => new Date().toISOString().slice(0, 10)

/** Draft PPB: the list of items to buy (from Request Barang or Safety Stock) — picked into one PPB. */
export function PpbDraftListPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'saved' ? 'saved' : params.get('tab') === 'docs' ? 'docs' : 'lines'
  const saved = useSavedDrafts()
  return (
    <div className="space-y-4">
      <PageHeader title="Draft Purchase Request" subtitle="Items to be purchased, from Item Requests (short / empty stock) and Safety Stock (Restock). Tick items, then submit them as one Purchase Request." />
      <div className="inline-flex rounded-lg border bg-card p-0.5">
        {([['lines', 'To do'], ['saved', `Drafts${saved.data?.length ? ` (${saved.data.length})` : ''}`], ['docs', 'Source history']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setParams(k === 'lines' ? {} : { tab: k })}
            className={tab === k ? 'rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary' : 'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted'}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'lines' ? <DraftLinesList /> : tab === 'saved' ? <SavedDraftsList /> : <DraftDocsList />}
    </div>
  )
}

/** Where a line comes from: a Request Barang (number, requester) or Safety Stock. */
function SourceCell({ l }: { l: DraftLineRow }) {
  const s = l.source
  if (s.type === 'REQUEST') {
    return (
      <div className="leading-tight">
        <span className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-800">Request</span>
        {s.urgency === 'URGENT' && <span className="ml-1 text-xs font-semibold text-red-600">Urgent</span>}
        <div className="mt-0.5 text-xs">
          {s.item_request_id ? <Link to={`/item-requests/${s.item_request_id}`} className=" text-primary hover:underline">{s.item_request_number}</Link> : s.item_request_number}
          {s.requester && <span className="text-muted-foreground"> · {s.requester}</span>}
        </div>
        {(s.divisi || s.needed_date) && <div className="text-xs text-muted-foreground">{[s.divisi, s.needed_date ? `needed ${new Date(s.needed_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : null].filter(Boolean).join(' · ')}</div>}
      </div>
    )
  }
  return (
    <div className="leading-tight">
      <span className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">Safety stock</span>
      <div className="mt-0.5 text-xs text-muted-foreground">Restock <span className="">{s.draft_number}</span>{s.created_by ? ` · ${s.created_by}` : ''}</div>
    </div>
  )
}

export function DraftLinesList() {
  const [source, setSource] = useState('')
  const [search, setSearch] = useState('')
  const { data, isLoading } = useDraftLines({ source: source || undefined, search: search.trim() || undefined })
  const act = useDraftLineActions()
  const savedAct = useSavedDraftActions()
  const [saving, setSaving] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [qty, setQty] = useState<Record<number, string>>({})
  const [open, setOpen] = useState(false)
  const [noPpb, setNoPpb] = useState('')
  const [tglPpb, setTglPpb] = useState(today())
  const [divisi, setDivisi] = useState('')
  const [keterangan, setKeterangan] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const rows = data?.data ?? []
  const by = data?.meta.by_source ?? {}
  const allOn = rows.length > 0 && rows.every((r) => picked.has(r.id))
  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const saveQty = (l: DraftLineRow) => {
    const v = Number((qty[l.id] ?? '').replace(',', '.'))
    if (qty[l.id] === undefined || v === l.qty) return
    if (!(v > 0)) { setErr('Qty must be more than 0.'); setQty((q) => { const n = { ...q }; delete n[l.id]; return n }); return }
    act.update.mutate({ id: l.id, qty: v }, { onError: (e) => setErr(apiErrorMessage(e)) })
  }
  const submit = () => {
    setErr(null)
    if (!noPpb.trim()) return invalidTo(setErr, 'Fill in the Purchase Request No.')
    act.submit.mutate({ line_ids: [...picked], no_ppb: noPpb.trim(), tgl_ppb: tglPpb, divisi: divisi.trim() || null, keterangan: keterangan.trim() || null }, {
      onSuccess: () => { setOpen(false); setPicked(new Set()); setNoPpb('') },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  const saveDraft = () => {
    setErr(null)
    savedAct.save.mutate({ line_ids: [...picked], name: draftName.trim() || null }, {
      onSuccess: () => { setSaving(false); setPicked(new Set()); setDraftName('') },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex max-w-full overflow-x-auto rounded-lg border bg-card p-0.5">
          {([['', 'All', (by.REQUEST ?? 0) + (by.RESTOCK ?? 0)], ['REQUEST', 'From request', by.REQUEST ?? 0], ['RESTOCK', 'Safety stock', by.RESTOCK ?? 0]] as const).map(([k, label, n]) => (
            <button key={k || 'all'} type="button" onClick={() => { setSource(k); setPicked(new Set()) }}
              className={source === k ? 'rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary' : 'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted'}>
              {label}{!source || source === k ? ` (${n})` : ''}
            </button>
          ))}
        </div>
        <Input className="sm:w-72" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item / request no. / requester" aria-label="Search" />
      </div>

      {/* phone: one card per item */}
      <Card className="overflow-hidden sm:hidden">
        <ul className="divide-y">
          {rows.map((l) => (
            <li key={l.id} className={picked.has(l.id) ? 'space-y-2 bg-primary/5 p-3 text-sm' : 'space-y-2 p-3 text-sm'}>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={picked.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.deskripsi_barang}`} />
                <span className="min-w-0">
                  <span className="block break-words font-medium">{l.deskripsi_barang}</span>
                  <span className="block text-xs text-muted-foreground">{l.kode_barang ?? 'New item'} · stock {fmtQty(l.available)}{l.same_item_lines > 1 ? ` · has ${l.same_item_lines}× in the list` : ''}</span>
                </span>
              </label>
              <div className="flex items-end justify-between gap-3 pl-7">
                <SourceCell l={l} />
                <div className="flex shrink-0 items-center gap-1">
                  <Input className="h-8 w-16 text-right tabular-nums" inputMode="decimal" aria-label={`Qty ${l.deskripsi_barang}`}
                    value={qty[l.id] ?? String(l.qty)} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} onBlur={() => saveQty(l)} />
                  <span className="text-xs text-muted-foreground">{l.satuan ?? ''}</span>
                  <button type="button" className="rounded p-1.5 text-muted-foreground hover:text-destructive" aria-label={`Delete ${l.deskripsi_barang}`}
                    onClick={async () => { if (await confirmDialog({ message: `Delete "${l.deskripsi_barang}" from Draft Purchase Request? This item will not be bought.`, danger: true })) act.remove.mutate(l.id) }}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
          {!isLoading && rows.length === 0 && <li className="px-3 py-10 text-center text-muted-foreground">No items need a Purchase Request.</li>}
        </ul>
      </Card>

      <Card className="hidden overflow-hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="whitespace-nowrap border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2.5"><input type="checkbox" className="size-4 accent-primary" aria-label="Select all" checked={allOn}
                  onChange={() => setPicked(allOn ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                <th className="min-w-[14rem] px-3 py-2.5 font-medium">Item</th>
                <th className="px-3 py-2.5 text-right font-medium">Stock</th>
                <th className="w-28 px-3 py-2.5 text-right font-medium">Qty</th>
                <th className="min-w-[12rem] px-3 py-2.5 font-medium">Source</th>
                <th className="w-10 px-3 py-2.5"><span className="sr-only">Delete</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((l) => (
                <tr key={l.id} className={picked.has(l.id) ? 'bg-primary/5 align-top' : 'align-top'}>
                  <td className="px-3 py-3"><input type="checkbox" className="size-4 accent-primary" checked={picked.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.deskripsi_barang}`} /></td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{l.deskripsi_barang}</div>
                    <div className="text-xs text-muted-foreground">
                      {[l.kode_barang ?? 'New item (outside the master)', l.catatan].filter(Boolean).join(' · ')}
                      {l.same_item_lines > 1 && <span className="ml-1 font-medium text-amber-700">· has {l.same_item_lines}× in the list</span>}
                    </div>
                    {l.basis && <div className="text-xs text-muted-foreground">{l.basis}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-muted-foreground">{fmtQty(l.available)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Input className="h-8 w-20 text-right tabular-nums" inputMode="decimal" aria-label={`Qty ${l.deskripsi_barang}`}
                        value={qty[l.id] ?? String(l.qty)} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} onBlur={() => saveQty(l)} />
                      <span className="w-10 text-xs text-muted-foreground">{l.satuan ?? ''}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3"><SourceCell l={l} /></td>
                  <td className="px-2 py-2">
                    <button type="button" className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Delete ${l.deskripsi_barang}`}
                      onClick={async () => { if (await confirmDialog({ message: `Delete "${l.deskripsi_barang}" from Draft Purchase Request? This item will not be bought.`, danger: true })) act.remove.mutate(l.id) }}>
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-12 text-center text-muted-foreground">No items need a Purchase Request.</td></tr>}
              {isLoading && <tr><td colSpan={6} className="px-3 py-12 text-center text-muted-foreground"><Loader2 className="mx-auto size-5 animate-spin" /></td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {err && !open && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
      <div className="sticky bottom-2 flex items-center justify-between gap-2 rounded-lg border bg-card p-2.5 shadow-md">
        <span className="text-sm text-muted-foreground">{picked.size ? `${picked.size} items selected` : ''}</span>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={picked.size === 0} onClick={() => { setErr(null); setSaving(true) }}>Save as draft</Button>
          <Button disabled={picked.size === 0} onClick={() => { setErr(null); setOpen(true) }}><Send className="size-4" /> Submit as Purchase Request</Button>
        </div>
      </div>

      <Modal open={saving} onClose={() => setSaving(false)} title="Save as draft" className="max-w-sm" description={`${picked.size} items wait in a draft. Nobody is asked to approve yet.`}
        footer={<>
          <Button variant="outline" size="sm" onClick={() => setSaving(false)}>Cancel</Button>
          <Button size="sm" disabled={savedAct.save.isPending} onClick={saveDraft}>{savedAct.save.isPending && <Loader2 className="size-4 animate-spin" />} Save draft</Button>
        </>}>
        <div className="space-y-1"><Label htmlFor="sd-name">Name <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="sd-name" autoFocus value={draftName} maxLength={150} onChange={(e) => setDraftName(e.target.value)} /></div>
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title="Submit as Purchase Request" description={`${picked.size} items become one Purchase Request document, then wait for Manager → Director approval.`}
        footer={<>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" disabled={act.submit.isPending} onClick={submit}>{act.submit.isPending && <Loader2 className="size-4 animate-spin" />} Submit</Button>
        </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="sl-no">Purchase Request No *</Label><Input id="sl-no" className="" autoFocus value={noPpb} maxLength={60} onChange={(e) => setNoPpb(e.target.value)} placeholder="PPB/NA/26/X/090" /></div>
          <div className="space-y-1"><Label htmlFor="sl-tgl">Purchase Request Date</Label><Input id="sl-tgl" type="date" value={tglPpb} onChange={(e) => setTglPpb(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="sl-div">Division</Label><Input id="sl-div" value={divisi} maxLength={30} onChange={(e) => setDivisi(e.target.value)} placeholder="empty = follows its source" /></div>
          <div className="space-y-1"><Label htmlFor="sl-ket">Remarks</Label><Input id="sl-ket" value={keterangan} maxLength={2000} onChange={(e) => setKeterangan(e.target.value)} /></div>
        </div>
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
      </Modal>
    </div>
  )
}

/** Picked items kept for later: continue them, send items back to To do, or ask for approval. */
function SavedDraftsList() {
  const { data, isLoading } = useSavedDrafts()
  const act = useSavedDraftActions()
  const lineAct = useDraftLineActions()
  const [editing, setEditing] = useState<SavedDraft | null>(null)
  const [qty, setQty] = useState<Record<number, string>>({})
  if (isLoading) return <p className="py-12 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></p>
  if (!data?.length) return <Card className="px-3 py-12 text-center text-sm text-muted-foreground">No drafts. Tick items in To do, then Save as draft.</Card>
  const saveQty = (id: number, was: number) => {
    const v = Number((qty[id] ?? '').replace(',', '.'))
    if (qty[id] === undefined || v === was) return
    if (!(v > 0)) { toast.invalid('Qty must be more than 0.'); setQty((q) => { const n = { ...q }; delete n[id]; return n }); return }
    lineAct.update.mutate({ id, qty: v }, { onError: (e) => toast.fromError(e, apiErrorMessage(e)) })
  }
  return (
    <div className="space-y-4">
      {data.map((d) => (
        <Card key={d.id} className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
            <div className="min-w-0">
              <div className="font-medium">{d.name || `Draft #${d.id}`}</div>
              <div className="text-xs text-muted-foreground">{[`${d.lines.length} items`, d.no_ppb, d.created_by, fmtDateTime(d.updated_at)].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" disabled={act.discard.isPending} onClick={async () => { if (await confirmDialog({ message: `Remove this draft? Its ${d.lines.length} items go back to To do.` })) act.discard.mutate(d.id) }}>Return all to To do</Button>
              <Button size="sm" onClick={() => setEditing(d)}><Send className="size-4" /> Continue</Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="whitespace-nowrap border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr><th className="min-w-[14rem] px-4 py-2 font-medium">Item</th><th className="px-3 py-2 text-right font-medium">Stock</th><th className="w-32 px-3 py-2 text-right font-medium">Qty</th><th className="w-px px-3 py-2"><span className="sr-only">Return</span></th></tr>
              </thead>
              <tbody className="divide-y">
                {d.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2"><div className="font-medium">{l.deskripsi_barang}</div><div className="text-xs text-muted-foreground">{l.kode_barang ?? 'New item (outside the master)'}</div></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtQty(l.available)}</td>
                    <td className="px-3 py-1.5"><div className="flex items-center justify-end gap-1">
                      <Input className="h-8 w-20 text-right tabular-nums" inputMode="decimal" aria-label={`Qty ${l.deskripsi_barang}`} value={qty[l.id] ?? String(l.qty)} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} onBlur={() => saveQty(l.id, l.qty)} />
                      <span className="w-10 text-xs text-muted-foreground">{l.satuan ?? ''}</span></div></td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right"><Button size="sm" variant="ghost" className="h-8" disabled={act.release.isPending} onClick={() => act.release.mutate({ id: d.id, line: l.id })}>Return to To do</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      {editing && <SavedDraftModal d={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** The header of a draft: keep it for later, or ask for approval. */
function SavedDraftModal({ d, onClose }: { d: SavedDraft; onClose: () => void }) {
  const act = useSavedDraftActions()
  const [name, setName] = useState(d.name ?? '')
  const [noPpb, setNoPpb] = useState(d.no_ppb ?? '')
  const [tglPpb, setTglPpb] = useState(d.tgl_ppb ?? today())
  const [divisi, setDivisi] = useState(d.divisi ?? '')
  const [keterangan, setKeterangan] = useState(d.keterangan ?? '')
  const [err, setErr] = useState<string | null>(null)
  const header = () => ({ no_ppb: noPpb.trim() || null, tgl_ppb: tglPpb || null, divisi: divisi.trim() || null, keterangan: keterangan.trim() || null })
  const busy = act.update.isPending || act.submit.isPending
  const ask = async () => {
    setErr(null)
    if (!noPpb.trim()) return invalidTo(setErr, 'Fill in the Purchase Request No.')
    if (!(await confirmDialog({ title: 'Request approval?', message: `${d.lines.length} items become one Purchase Request document, then wait for Manager → Director approval.`, confirmLabel: 'Request approval' }))) return
    act.submit.mutate({ id: d.id, no_ppb: noPpb.trim(), tgl_ppb: tglPpb || today(), divisi: divisi.trim() || null, keterangan: keterangan.trim() || null }, { onSuccess: onClose, onError: (e) => setErr(apiErrorMessage(e)) })
  }
  return (
    <Modal open onClose={onClose} title={d.name || `Draft #${d.id}`} description={`${d.lines.length} items`}
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => act.update.mutate({ id: d.id, name: name.trim() || null, ...header() }, { onSuccess: onClose, onError: (e) => setErr(apiErrorMessage(e)) })}>Save draft</Button>
        <Button size="sm" disabled={busy} onClick={() => void ask()}>{act.submit.isPending && <Loader2 className="size-4 animate-spin" />} Request approval</Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="sv-name">Draft name</Label><Input id="sv-name" value={name} maxLength={150} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="sv-no">Purchase Request No *</Label><Input id="sv-no" value={noPpb} maxLength={60} onChange={(e) => setNoPpb(e.target.value)} placeholder="PPB/NA/26/X/090" /></div>
        <div className="space-y-1"><Label htmlFor="sv-tgl">Purchase Request Date</Label><Input id="sv-tgl" type="date" value={tglPpb} onChange={(e) => setTglPpb(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="sv-div">Division</Label><Input id="sv-div" value={divisi} maxLength={30} onChange={(e) => setDivisi(e.target.value)} placeholder="empty = follows its source" /></div>
        <div className="space-y-1"><Label htmlFor="sv-ket">Remarks</Label><Input id="sv-ket" value={keterangan} maxLength={2000} onChange={(e) => setKeterangan(e.target.value)} /></div>
      </div>
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
    </Modal>
  )
}

/** The draft documents themselves (each Restock / each request's shortage), and what became of them. */
function DraftDocsList() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading } = usePpbDrafts({ status: status || undefined, page })
  const { rows, footer } = useInfiniteRows(data, page, setPage)
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'number', header: 'No. Draft', cell: (r) => <span className="text-[13px] font-semibold text-primary">{r.number}</span> },
    { key: 'lines', header: 'Item', cell: (r) => `${r.lines_count} items` },
    { key: 'src', header: 'Source', cell: (r) => r.item_request_number ? <span className="whitespace-nowrap">Request <span className="text-[13px]">{r.item_request_number}</span></span> : <span className="text-muted-foreground">Safety stock</span> },
    { key: 'by', header: 'Created', cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.created_at)}{r.created_by_name ? ` · ${r.created_by_name}` : ''}</span> },
    { key: 'ppb', header: 'Purchase Request No', cell: (r) => r.no_ppb ? <span className="text-[13px]">{r.no_ppb}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'status', header: 'Status', cell: (r) => <Badge variant={DRAFT_STATUS[r.status].variant}>{DRAFT_STATUS[r.status].label}</Badge> },
  ]
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border bg-card p-0.5">
        {([['', 'All'], ['DRAFT', 'There are still items'], ['DIAJUKAN', 'Already a Purchase Request'], ['DIBATALKAN', 'Cancelled']] as const).map(([k, label]) => (
          <button key={k || 'all'} type="button" onClick={() => { setStatus(k); setPage(1) }}
            className={status === k ? 'rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary' : 'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted'}>
            {label}
          </button>
        ))}
      </div>
      <DataTable columns={columns} rows={rows} footer={footer} rowKey={(r) => r.id} isLoading={isLoading}
        onRowClick={(r) => navigate(`/ppb/drafts/${r.id}`)} emptyText="No drafts yet." />
    </div>
  )
}

type EditLine = PpbDraftLine & { key: string }

/** Review / edit one Draft PPB, then submit it as a PPB (same as Tambah PPB, then PPB approval). */
export function PpbDraftPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: d, isLoading } = usePpbDraft(Number(id))
  const act = useDraftActions(Number(id))
  const [lines, setLines] = useState<EditLine[]>([])
  const [divisi, setDivisi] = useState('')
  const [tglDiperlukan, setTglDiperlukan] = useState('')
  const [peminta, setPeminta] = useState('')
  const [keterangan, setKeterangan] = useState('')
  const [dirty, setDirty] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [noPpb, setNoPpb] = useState('')
  const [tglPpb, setTglPpb] = useState(today())

  useEffect(() => {
    if (!d) return
    setLines(d.lines.map((l) => ({ ...l, key: String(l.id) })))
    setDivisi(d.divisi ?? ''); setTglDiperlukan(d.tgl_diperlukan ?? ''); setPeminta(d.peminta ?? ''); setKeterangan(d.keterangan ?? '')
    setDirty(false)
  }, [d])

  if (isLoading || !d) return <div className="space-y-4"><BackLink to="/ppb/drafts" label="Draft Purchase Request" /><DetailFallback loading={isLoading} /></div>
  const editable = d.status === 'DRAFT'
  const change = <K extends keyof EditLine>(key: string, k: K, v: EditLine[K]) => { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [k]: v } : l))); setDirty(true) }
  const addItem = (it: ItemLookupResult) => {
    setLines((ls) => [...ls, { key: `n${Date.now()}`, item_id: it.id, kode_barang: it.code, deskripsi_barang: it.description, qty: 1, satuan: it.unit ?? null, catatan: null, available: it.available }])
    setDirty(true)
  }
  const addFree = () => { setLines((ls) => [...ls, { key: `n${Date.now()}`, item_id: null, kode_barang: null, deskripsi_barang: '', qty: 1, satuan: null, catatan: null }]); setDirty(true) }
  const payload = () => ({
    divisi: divisi.trim() || null, tgl_diperlukan: tglDiperlukan || null, peminta: peminta.trim() || null, keterangan: keterangan.trim() || null,
    lines: lines.map((l) => ({ id: l.id, item_id: l.item_id, kode_barang: l.kode_barang, deskripsi_barang: l.deskripsi_barang.trim(), qty: Number(l.qty), satuan: l.satuan, catatan: l.catatan?.trim() || null })),
  })
  const check = () => {
    if (lines.length === 0) return 'A draft must have at least one item.'
    const bad = lines.find((l) => !l.deskripsi_barang.trim() || !(Number(l.qty) > 0))
    return bad ? 'Each row needs an item name and qty above 0.' : null
  }
  const save = () => {
    setErr(null)
    const e = check(); if (e) return invalidTo(setErr, e)
    act.save.mutate(payload(), { onSuccess: () => setDirty(false), onError: (x) => setErr(apiErrorMessage(x)) })
  }
  const submit = async () => {
    setErr(null)
    const e = check(); if (e) return invalidTo(setErr, e)
    if (!noPpb.trim()) return invalidTo(setErr, 'Fill in the Purchase Request No.')
    try {
      await act.save.mutateAsync(payload())
      await act.submit.mutateAsync({ no_ppb: noPpb.trim(), tgl_ppb: tglPpb })
      setSubmitting(false)
    } catch (x) { setErr(apiErrorMessage(x)) }
  }

  return (
    <div className="space-y-4">
      <BackLink to="/ppb/drafts" label="Draft Purchase Request" />
      <PageHeader title={`Draft ${d.number}`}
        subtitle={`${d.lines_count} items · ${d.item_request_number ? `from request ${d.item_request_number}` : 'from Restock'} · created ${fmtDateTime(d.created_at)}${d.created_by_name ? ` by ${d.created_by_name}` : ''}`}
        actions={<>
          <Badge variant={DRAFT_STATUS[d.status].variant}>{DRAFT_STATUS[d.status].label}</Badge>
          {editable && (
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={act.cancel.isPending}
              onClick={async () => { if (await confirmDialog({ message: `Cancel draft ${d.number}?`, danger: true })) act.cancel.mutate(undefined, { onSuccess: () => navigate('/ppb/drafts') }) }}>
              <Ban className="size-4" /> Cancel draft
            </Button>
          )}
        </>} />
      <SmartButtons type="ppb_draft" id={Number(id)} />

      <ChatterLayout chatter={<Chatter type="ppb_draft" id={Number(id)} />}>
        {d.status === 'DIAJUKAN' && (
          <Card className="flex flex-wrap items-center justify-between gap-2 border-emerald-200 bg-emerald-50/60 p-4 text-sm">
            <span>Already submitted as Purchase Request <b className="">{d.no_ppb}</b> · {fmtDateTime(d.submitted_at)}{d.submitted_by_name ? ` by ${d.submitted_by_name}` : ''}. Waiting for PPB approval.</span>
            {d.ppb_id && <Link to={`/ppb/${d.ppb_id}`} className="font-medium text-primary hover:underline">Open Purchase Request</Link>}
          </Card>
        )}

        <Card className="grid gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-4">
          <div className="space-y-1"><Label htmlFor="dr-divisi">Division</Label><Input id="dr-divisi" value={divisi} maxLength={30} disabled={!editable} onChange={(e) => { setDivisi(e.target.value); setDirty(true) }} placeholder="e.g. WAREHOUSE" /></div>
          <div className="space-y-1"><Label htmlFor="dr-tgl">Date needed</Label><Input id="dr-tgl" type="date" value={tglDiperlukan} disabled={!editable} onChange={(e) => { setTglDiperlukan(e.target.value); setDirty(true) }} /></div>
          <div className="space-y-1"><Label htmlFor="dr-peminta">Requester</Label><Input id="dr-peminta" value={peminta} maxLength={150} disabled={!editable} onChange={(e) => { setPeminta(e.target.value); setDirty(true) }} /></div>
          <div className="space-y-1"><Label htmlFor="dr-ket">Remarks</Label><Input id="dr-ket" value={keterangan} maxLength={2000} disabled={!editable} onChange={(e) => { setKeterangan(e.target.value); setDirty(true) }} placeholder={`Restock from ${d.number}`} /></div>
        </Card>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted text-left">
                <tr>
                  <th className="w-10 px-3 py-2.5">#</th>
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5 text-right">Available</th>
                  <th className="w-28 px-3 py-2.5 text-right">Qty</th>
                  <th className="w-24 px-3 py-2.5">Unit</th>
                  <th className="px-3 py-2.5">Notes</th>
                  {editable && <th className="w-10 px-3 py-2.5"><span className="sr-only">Delete</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((l, i) => (
                  <tr key={l.key} className="align-top">
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2">
                      {l.item_id ? (
                        <><div className="font-medium">{l.deskripsi_barang}</div><div className="text-[13px] text-muted-foreground">{l.kode_barang}</div></>
                      ) : (
                        <Input value={l.deskripsi_barang} disabled={!editable} maxLength={400} placeholder="Item name (not in Product Master yet)" aria-label={`Row item name ${i + 1}`}
                          onChange={(e) => change(l.key, 'deskripsi_barang', e.target.value)} />
                      )}
                      {l.basis && <div className="mt-0.5 text-xs text-muted-foreground">{l.basis}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground">{fmtQty(l.available)}</td>
                    <td className="px-3 py-2">
                      <Input type="number" inputMode="decimal" min={0} step="any" className="text-right" value={l.qty} disabled={!editable} aria-label={`Row qty ${i + 1}`}
                        onChange={(e) => change(l.key, 'qty', e.target.value === '' ? 0 : Number(e.target.value))} />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={l.satuan ?? ''} disabled={!editable || !!l.item_id} maxLength={30} aria-label={`Row unit ${i + 1}`} onChange={(e) => change(l.key, 'satuan', e.target.value || null)} />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={l.catatan ?? ''} disabled={!editable} maxLength={255} placeholder="optional" aria-label={`Row notes ${i + 1}`} onChange={(e) => change(l.key, 'catatan', e.target.value || null)} />
                    </td>
                    {editable && (
                      <td className="px-2 py-2">
                        <button type="button" className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Delete row ${i + 1}`}
                          onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true) }}><Trash2 className="size-4" /></button>
                      </td>
                    )}
                  </tr>
                ))}
                {lines.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">No items yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {editable && (
            <div className="flex flex-col gap-2 border-t bg-muted/30 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><ItemPicker onPick={addItem} /></div>
              <Button variant="outline" size="sm" onClick={addFree}><Plus className="size-4" /> Item outside the master</Button>
            </div>
          )}
        </Card>

        {err && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
        {editable && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={act.save.isPending || !dirty} onClick={save}><Save className="size-4" /> {dirty ? 'Save draft' : 'Saved'}</Button>
            <Button onClick={() => { setErr(null); setSubmitting(true) }}><Send className="size-4" /> Submit as Purchase Request</Button>
          </div>
        )}
      </ChatterLayout>


      <Modal open={submitting} onClose={() => setSubmitting(false)} title="Submit as Purchase Request" description={`${lines.length} items from ${d.number} into one Purchase Request document, then waits for Purchase Request approval.`}
        footer={<>
          <Button variant="outline" size="sm" onClick={() => setSubmitting(false)}>Cancel</Button>
          <Button size="sm" disabled={act.submit.isPending || act.save.isPending} onClick={submit}>
            {(act.submit.isPending || act.save.isPending) && <Loader2 className="size-4 animate-spin" />} Submit
          </Button>
        </>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="sb-no">Purchase Request No *</Label><Input id="sb-no" className="" autoFocus value={noPpb} maxLength={60} onChange={(e) => setNoPpb(e.target.value)} placeholder="PPB/NA/26/X/090" /></div>
          <div className="space-y-1"><Label htmlFor="sb-tgl">Purchase Request Date</Label><Input id="sb-tgl" type="date" value={tglPpb} onChange={(e) => setTglPpb(e.target.value)} /></div>
        </div>
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
      </Modal>
    </div>
  )
}
