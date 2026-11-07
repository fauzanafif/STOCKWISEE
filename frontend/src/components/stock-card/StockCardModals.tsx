import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiErrorMessage } from '@/lib/api'
import { nextStockCardNumber, useCreateStockCard, useSaveStockCardProject, type StockCardProject, type StockCardProjectInput } from '@/features/stock-card/api'
import { routePaths, useStockCardScope } from '@/features/stock-card/scope'
import { StockCardItemPicker, type StockCardItemOption } from '@/components/StockCardItemPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { invalidTo } from '@/lib/notify'

/** New Kartu Stock in a project: the item from Master Barang (code / name), Nama / Kode / Satuan follow it. */
export function CreateStockCardModal({ project, open, onClose }: { project: { id: number; name: string }; open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const scope = useStockCardScope()
  const create = useCreateStockCard()
  const empty = { card_number: '', location_warehouse: '', location_rack: '', person_in_charge: '', director_name: '' }
  const [item, setItem] = useState<StockCardItemOption | null>(null)
  const [form, setForm] = useState(empty)
  const [err, setErr] = useState<string | null>(null)

  async function pick(it: StockCardItemOption) {
    setItem(it)
    setErr(null)
    let number = it.code // like the paper card: the item code
    try {
      number = await nextStockCardNumber(scope, it.id, project.id)
    } catch { /* keep the code */ }
    setForm((f) => ({ ...f, card_number: number }))
  }

  function close() {
    setItem(null)
    setForm(empty)
    setErr(null)
    onClose()
  }

  function save() {
    if (!item) return invalidTo(setErr, 'Select an item first.')
    const t = (v: string) => v.trim() || null
    create.mutate(
      { project_id: project.id, item_id: item.id, card_number: form.card_number.trim(), location_warehouse: t(form.location_warehouse),
        location_rack: t(form.location_rack), person_in_charge: t(form.person_in_charge), director_name: t(form.director_name) },
      { onSuccess: (card) => { close(); navigate(routePaths(scope).card(card.id)) }, onError: (e) => setErr(apiErrorMessage(e)) },
    )
  }

  const input = (k: keyof typeof empty, label: string, placeholder?: string) => (
    <label className="space-y-1 text-xs text-muted-foreground">
      {label}
      <Input value={form[k]} placeholder={placeholder} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
    </label>
  )

  return (
    <Modal form
      open={open}
      onClose={close}
      title="Create Stock Card"
 description={<>Project <b>{project.name}</b> one card per item. Items from the Item Master (search code or name).</>}
      footer={(
        <>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={save} disabled={!item || !form.card_number.trim() || create.isPending}>Create Card</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Item</label>
          <StockCardItemPicker selected={item} onPick={pick} projectId={project.id} />
        </div>
        {item && (
          <div className="grid gap-x-6 gap-y-1 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-[8rem_1fr]">
            <span className="text-muted-foreground">Item Name</span><span className="font-medium">{item.description}</span>
            <span className="text-muted-foreground">Item Code</span><span className="">{item.code}</span>
 <span className="text-muted-foreground">Unit</span><span>{item.unit ?? ''}</span>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {input('card_number', 'Card Number', 'e.g. EAE.0291')}
          {input('person_in_charge', 'Person in Charge')}
          {input('location_warehouse', 'Warehouse Location', 'e.g. WAREHOUSE 1')}
          {input('location_rack', 'Rack Location', 'e.g. RACK A.11')}
          {input('director_name', 'Director (name in signature column)')}
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

/** New project, or edit one (name, code, status). */
export function ProjectModal({ project, open, onClose, onSaved }: { project?: StockCardProject; open: boolean; onClose: () => void; onSaved?: (p: StockCardProject) => void }) {
  const save = useSaveStockCardProject(project?.id)
  const [form, setForm] = useState<StockCardProjectInput>({ name: project?.name ?? '', code: project?.code ?? '', status: project?.status ?? 'ACTIVE' })
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    setErr(null)
    save.mutate({ name: form.name.trim(), code: form.code?.trim() || null, status: form.status }, {
      onSuccess: (p) => { onClose(); onSaved?.(p) },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  return (
    <Modal form
      open={open}
      onClose={onClose}
      title={project ? 'Edit Project' : 'Create Project'}
 description="One project (e.g. CCTV installation) holds many stock cards, one card per item."
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!form.name.trim() || save.isPending}>Save</Button>
        </>
      )}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
          Project Name
          <Input value={form.name} placeholder="e.g. CCTV Installation Building A" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Project Code (optional)
          <Input value={form.code ?? ''} placeholder="e.g. PRJ-CCTV-01" onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
        </label>
        {project && (
          <label className="space-y-1 text-xs text-muted-foreground">
            Status
            <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'ACTIVE' | 'CLOSED' }))}>
              <option value="ACTIVE">Running</option>
              <option value="CLOSED">Done</option>
            </Select>
          </label>
        )}
      </div>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
    </Modal>
  )
}
