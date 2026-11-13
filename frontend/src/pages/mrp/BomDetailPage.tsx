import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Archive, CheckCircle2, Copy, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/notify'
import { ACTIVITY_LABEL, fmtDate, fmtDateTime, fmtQty, useBom, useBomStep, useSaveBom, type BomDetail, type MrpItem } from '@/features/mrp/api'
import { BomStatusBadge, MrpItemPicker, Warn } from '@/components/mrp/MrpParts'
import { BackLink } from '@/components/BackLink'
import { DetailFallback } from '@/components/DetailFallback'
import { Activity, DocPage, DocSection, MetaList } from '@/components/doc/DocLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { confirmDialog } from '@/components/ui/confirm'

type Line = { item_id: number; code: string | null; description: string | null; unit: string | null; qty: string; note: string }
type Form = { product: { id: number; code: string | null; description: string | null; unit: string | null } | null; name: string; effective_date: string; notes: string; lines: Line[] }

const fromBom = (b: BomDetail): Form => ({
  product: { id: b.item_id, code: b.product_code, description: b.product_name, unit: b.base_unit },
  name: b.name ?? '', effective_date: b.effective_date ?? '', notes: b.notes ?? '',
  lines: b.lines.map((l) => ({ item_id: l.item_id, code: l.code, description: l.description, unit: l.base_unit, qty: l.qty_text, note: l.note ?? '' })),
})

/** The editor of a draft BoM (and of a new one): product, components with their quantity per 1 product, in Base UOM. */
function BomEditor({ bom, onDone }: { bom?: BomDetail; onDone: (id: number) => void }) {
  const save = useSaveBom()
  const [f, setF] = useState<Form>(() => (bom ? fromBom(bom) : { product: null, name: '', effective_date: '', notes: '', lines: [] }))
  const [err, setErr] = useState<string | null>(null)
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }))
  const setLine = (i: number, patch: Partial<Line>) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }))
  const add = (it: MrpItem) => setF((x) => ({ ...x, lines: [...x.lines, { item_id: it.id, code: it.code, description: it.description, unit: it.unit, qty: '1', note: '' }] }))

  const submit = () => {
    setErr(null)
    if (!f.product) return setErr('Select the finished product.')
    if (f.lines.length === 0) return setErr('Add at least one component.')
    const bad = f.lines.find((l) => !(Number(l.qty.replace(',', '.')) > 0))
    if (bad) return setErr(`Quantity of ${bad.code} must be more than 0.`)
    save.mutate({
      id: bom?.id,
      data: {
        ...(bom ? {} : { item_id: f.product.id }),
        name: f.name.trim() || null, effective_date: f.effective_date || null, notes: f.notes.trim() || null,
        lines: f.lines.map((l) => ({ item_id: l.item_id, qty: l.qty.replace(',', '.').trim(), note: l.note.trim() || null })),
      },
    }, {
      onSuccess: (d) => { toast.success(bom ? 'BoM saved.' : `BoM ${d.code} created.`); onDone(d.id) },
      onError: (e) => { setErr(apiErrorMessage(e)); toast.fromError(e, apiErrorMessage(e)) },
    })
  }

  return (
    <div className="space-y-4">
      <DocSection title="Finished product" className="overflow-visible">
        {f.product ? (
          <div className="flex items-center justify-between gap-3">
            <div><div className="font-medium">{f.product.description}</div><div className="text-xs text-muted-foreground">{f.product.code} · Base UOM {f.product.unit}</div></div>
            {!bom && <Button variant="ghost" size="sm" onClick={() => set({ product: null })}><X className="size-4" /> Change</Button>}
          </div>
        ) : <MrpItemPicker onPick={(it) => set({ product: { id: it.id, code: it.code, description: it.description, unit: it.unit }, name: f.name || it.description })} placeholder="Search the finished product…" />}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">BoM name</span><Input value={f.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Effective date (optional)</span><Input type="date" value={f.effective_date} onChange={(e) => set({ effective_date: e.target.value })} /></label>
          <label className="space-y-1 sm:col-span-3"><span className="text-xs text-muted-foreground">Notes</span><Textarea rows={2} value={f.notes} maxLength={2000} onChange={(e) => set({ notes: e.target.value })} /></label>
        </div>
      </DocSection>

      <DocSection title="Components" count={f.lines.length} flush className="overflow-visible">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-100 text-left text-xs text-slate-600">
              <tr><th className="px-3 py-2">Component</th><th className="px-3 py-2 text-right">Qty per 1 {f.product?.unit ?? 'product'}</th><th className="px-3 py-2">Base UOM</th><th className="px-3 py-2">Note</th><th className="w-10" /></tr>
            </thead>
            <tbody>
              {f.lines.map((l, i) => (
                <tr key={l.item_id} className="border-t">
                  <td className="px-3 py-2"><div className="font-medium">{l.description}</div><div className="text-xs text-muted-foreground">{l.code}</div></td>
                  <td className="px-3 py-2"><Input className="ml-auto w-28 text-right tabular-nums" inputMode="decimal" value={l.qty} aria-label={`Qty ${l.code}`} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                  <td className="px-3 py-2 text-muted-foreground">{l.unit}</td>
                  <td className="px-3 py-2"><Input value={l.note} maxLength={255} placeholder="Optional" onChange={(e) => setLine(i, { note: e.target.value })} /></td>
                  <td className="px-1"><Button variant="ghost" size="sm" aria-label={`Remove ${l.code}`} onClick={() => setF((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))}><Trash2 className="size-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t p-3"><MrpItemPicker onPick={add} exclude={[...(f.product ? [f.product.id] : []), ...f.lines.map((l) => l.item_id)]} placeholder="Add a component…" /></div>
      </DocSection>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button disabled={save.isPending} onClick={submit}>{save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save draft</Button>
      </div>
    </div>
  )
}

/** keyed by id: opening another revision starts with a fresh page (not in edit mode) */
export function BomDetailPage() {
  // /mrp/boms/new is its own route (no :id param) → treat a missing id as a new BoM
  const id = useParams().id ?? 'new'
  return <BomDetailView key={id} id={id} />
}

function BomDetailView({ id }: { id: string }) {
  const navigate = useNavigate()
  const isNew = id === 'new'
  const { hasPermission } = useAuth()
  const { data: b, isLoading } = useBom(isNew ? null : Number(id))
  const step = useBomStep(Number(id))
  const [editing, setEditing] = useState(false)
  const manage = hasPermission('mrp.bom.manage')
  const onError = (e: unknown) => toast.fromError(e, apiErrorMessage(e))

  if (isNew) {
    return (
      <div className="space-y-4">
        <BackLink to="/mrp/boms" label="Bills of Materials" />
        <h1 className="text-lg font-semibold">New Bill of Materials</h1>
        <BomEditor onDone={(newId) => navigate(`/mrp/boms/${newId}`, { replace: true })} />
      </div>
    )
  }
  if (isLoading || !b) return <div className="space-y-4"><BackLink to="/mrp/boms" label="Bills of Materials" /><DetailFallback loading={isLoading} /></div>

  const actions = manage ? (
    <>
      {b.status === 'DRAFT' && !editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>}
      {b.status === 'DRAFT' && !editing && (
        <Button size="sm" disabled={step.activate.isPending} onClick={async () => {
          if (await confirmDialog({ message: 'Activate this BoM? New Manufacturing Orders of this product will use it; the current active revision is archived.', confirmLabel: 'Activate' }))
            step.activate.mutate(undefined, { onSuccess: () => toast.success('BoM activated.'), onError })
        }}><CheckCircle2 className="size-4" /> Activate</Button>
      )}
      <Button size="sm" variant="outline" disabled={step.revise.isPending}
        onClick={() => step.revise.mutate(undefined, { onSuccess: (d) => { toast.success(`Revision ${d.revision} created as draft.`); navigate(`/mrp/boms/${d.id}`) }, onError })}>
        <Copy className="size-4" /> New revision
      </Button>
      {b.status === 'ACTIVE' && (
        <Button size="sm" variant="outline" disabled={step.archive.isPending} onClick={async () => {
          if (await confirmDialog({ message: 'Archive this BoM? No new Manufacturing Order can use it; existing ones keep their own copy.', confirmLabel: 'Archive' }))
            step.archive.mutate(undefined, { onSuccess: () => toast.success('BoM archived.'), onError })
        }}><Archive className="size-4" /> Archive</Button>
      )}
      {b.status === 'DRAFT' && b.used_by === 0 && !editing && (
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={step.remove.isPending} onClick={async () => {
          if (await confirmDialog({ message: 'Delete this draft BoM?', danger: true }))
            step.remove.mutate(undefined, { onSuccess: () => { toast.success('Draft deleted.'); navigate('/mrp/boms') }, onError })
        }}><Trash2 className="size-4" /> Delete</Button>
      )}
    </>
  ) : undefined

  return (
    <DocPage back={{ to: '/mrp/boms', label: 'Bills of Materials' }} kind="Bill of Materials" number={b.code}
      status={<><BomStatusBadge status={b.status} /><span className="text-xs text-muted-foreground">Revision {b.revision}</span></>}
      subtitle={[b.product_code, b.product_name].filter(Boolean).join(' · ')} actions={actions}
      aside={<>
        <DocSection title="Information">
          <MetaList items={[
            { label: 'Finished product', value: b.product_name },
            { label: 'Base UOM', value: b.base_unit },
            { label: 'Effective date', value: fmtDate(b.effective_date) },
            { label: 'Used by MO', value: b.used_by },
            { label: 'Created', value: `${b.created_by_name ?? '-'} · ${fmtDateTime(b.created_at)}` },
            { label: 'Activated', value: b.activated_at ? `${b.activated_by_name ?? '-'} · ${fmtDateTime(b.activated_at)}` : null, hidden: !b.activated_at },
          ]} />
        </DocSection>
        <DocSection title="Revisions" count={b.revisions.length}>
          <ul className="space-y-1.5">
            {b.revisions.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                {r.id === b.id ? <span className="font-medium">Rev {r.revision} · {r.code}</span> : <Link to={`/mrp/boms/${r.id}`} className="text-primary hover:underline">Rev {r.revision} · {r.code}</Link>}
                <BomStatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </DocSection>
        <DocSection title="Activity">
          <Activity items={b.activity.map((a) => ({ id: a.id, label: ACTIVITY_LABEL[a.action] ?? a.action, who: a.user_name, at: a.at, note: a.note }))} />
        </DocSection>
      </>}>
      {b.status === 'ARCHIVED' && <Warn tone="info">Archived revision: kept for history. Manufacturing Orders made from it keep their own copy of the components.</Warn>}
      {b.lines.some((l) => !l.item_active) && <Warn>A component is no longer active in the Product Master. Activation will be refused until it is replaced.</Warn>}
      {editing ? <BomEditor bom={b} onDone={() => setEditing(false)} /> : (
        <DocSection title="Components" count={b.lines.length} flush>
          <ul className="divide-y">
            {b.lines.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0"><div className="font-medium">{l.description}</div><div className="text-[13px] text-muted-foreground">{l.code}{l.note ? ` · ${l.note}` : ''}</div></div>
                <div className="shrink-0 text-right tabular-nums">{fmtQty(l.qty)} <span className="text-muted-foreground">{l.base_unit}</span><div className="text-xs text-muted-foreground">per 1 {b.base_unit}</div></div>
              </li>
            ))}
          </ul>
        </DocSection>
      )}
      {b.notes && !editing && <DocSection title="Notes"><p className="whitespace-pre-wrap">{b.notes}</p></DocSection>}
      {!editing && manage && b.status === 'DRAFT' && b.lines.length === 0 && (
        <Button variant="outline" onClick={() => setEditing(true)}><Plus className="size-4" /> Add components</Button>
      )}
    </DocPage>
  )
}
