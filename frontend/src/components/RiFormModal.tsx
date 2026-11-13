import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, CheckCircle2, ChevronDown, FileText, Loader2, Printer, Search, Upload, X } from 'lucide-react'
import { filledSerials, RiSerialEntry, RiSerialExcelButtons, serialProblem } from '@/components/RiSerialEntry'
import { photoToDataUrl } from '@/components/tracking/EvidencePhoto'
import { downloadRiSerialTemplate, importRiSerials, RI_SOURCE, useCreateRi, useCreateRiFromPo, useRiPoOrders, useRiUsedReturnLines, riJenis, type Ri, type RiCreatePayload, type RiFromPoPayload, type RiPoOrder, type RiSource, type RiUsedReturnLine } from '@/features/ri/api'
import { cn } from '@/lib/utils'
import { useItemLookup, type ItemLookupResult } from '@/features/inventory/api'
import { saveOnce } from '@/lib/duplicate'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { PrintDocButton } from '@/components/PrintDocButton'
import { apiErrorMessage } from '@/lib/api'
import { invalidTo, toast } from '@/lib/notify'

interface Props {
  open: boolean
  onClose: () => void
}

const JENIS_RI: Array<'NA' | 'ATK' | 'NV'> = ['NA', 'ATK', 'NV']

/** Dropdown saran barang bersama — dirender di bawah Kode Barang atau Deskripsi Barang, siapa pun yang sedang fokus. */
function ItemSuggestions({ items, loading, onPick }: { items: ItemLookupResult[] | undefined; loading: boolean; onPick: (item: ItemLookupResult) => void }) {
  return (
    <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-card text-sm shadow-md">
      {loading && <li className="px-3 py-2 text-muted-foreground">Searching…</li>}
      {!loading && (items?.length ?? 0) === 0 && <li className="px-3 py-2 text-muted-foreground">No results.</li>}
      {items?.map((it) => (
        <li key={it.id}>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left hover:bg-muted"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(it)}
          >
            <span className="text-[13px] text-muted-foreground">{it.code}</span> {it.description}
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Form "Tambah RI" — untuk penerimaan barang yang dicatat manual di Stockwise,
 * bukan hasil Sync Accurate. Kode Barang & Deskripsi Barang saling mengisi
 * otomatis (ketik salah satu, pilih dari saran, keduanya terisi).
 */
/** Proof photos of the goods received, per RI. */
const MAX_PHOTOS = 3
/** documents of the delivery (surat jalan / invoice) of a RI dari PO */
const MAX_DOCS = 3
const fmtQty = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
/** the "line" of a manual RI in its serial Excel */
const MANUAL_KEY = 0

export function RiFormModal({ open, onClose }: Props) {
  const create = useCreateRi()

  const [divisi, setDivisi] = useState<'NA' | 'ATK' | 'NV'>('NV')
  const [vendor, setVendor] = useState('')
  const [noPo, setNoPo] = useState('')
  const [noSuratJalan, setNoSuratJalan] = useState('')
  const [kodeBarang, setKodeBarang] = useState('')
  const [deskripsiBarang, setDeskripsiBarang] = useState('')
  const [activeField, setActiveField] = useState<'kode' | 'deskripsi' | null>(null)
  const [kuantitas, setKuantitas] = useState<number | ''>('')
  const [satuan, setSatuan] = useState('')
  const [hargaSatuan, setHargaSatuan] = useState<number | ''>('')
  const [noSeri, setNoSeri] = useState<string[]>([])
  const [pemeriksa, setPemeriksa] = useState('')
  const [tglRi, setTglRi] = useState('')
  const [keterangan, setKeterangan] = useState('')
  const [err, setErr] = useState<string | null>(null)
  // proof of the goods received: 1 to 3 photos (required)
  const [photos, setPhotos] = useState<string[]>([])
  const [reading, setReading] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const [createdDoc, setCreatedDoc] = useState<Ri | null>(null)
  // goods of a STOCKWISE PO: its lines count them as received (part or all)
  const [poSearch, setPoSearch] = useState('')
  // "From PO": the picked PO, per line how much arrived and its serial numbers, and the documents
  const [poOrder, setPoOrder] = useState<RiPoOrder | null>(null)
  const [poQty, setPoQty] = useState<Record<number, string>>({})
  const [poSeri, setPoSeri] = useState<Record<number, string[]>>({})
  const [serialsOpen, setSerialsOpen] = useState<number | null>(null)
  // RI dari PO: the proof per item (1 to 3 photos of each item received)
  const [poPhotos, setPoPhotos] = useState<Record<number, string[]>>({})
  const linePhotoInput = useRef<HTMLInputElement>(null)
  const [photoFor, setPhotoFor] = useState<number | null>(null)
  const [docs, setDocs] = useState<{ data: string; name: string }[]>([])
  const docInput = useRef<HTMLInputElement>(null)
  const createFromPo = useCreateRiFromPo()
  // where the goods come from: a PO, used goods back (Pengembalian Bekas), or manual (tied to nothing)
  const [source, setSource] = useState<RiSource>('PO')
  const poOrders = useRiPoOrders(poSearch, open && source === 'PO' && !poOrder)
  const [usedLine, setUsedLine] = useState<RiUsedReturnLine | null>(null)
  const [usedSearch, setUsedSearch] = useState('')
  const usedLines = useRiUsedReturnLines(usedSearch, open && source === 'BEKAS' && !usedLine)
  // success screen -> print preview (replaces it, never stacked on / inside it)
  const [printing, setPrinting] = useState(false)

  const lookupQuery = activeField === 'kode' ? kodeBarang : activeField === 'deskripsi' ? deskripsiBarang : ''
  const { data: suggestions, isFetching: searchingItems } = useItemLookup(lookupQuery)

  useEffect(() => {
    if (!open) return
    setDivisi('NV'); setVendor(''); setNoPo(''); setNoSuratJalan('')
    setKodeBarang(''); setDeskripsiBarang(''); setActiveField(null)
    setKuantitas(''); setSatuan(''); setHargaSatuan(''); setNoSeri([]); setSerialsOpen(null); setPemeriksa('')
    setTglRi(new Date().toISOString().slice(0, 10)); setKeterangan(''); setErr(null); setCreatedDoc(null); setPrinting(false)
    setPoSearch(''); setPhotos([]); setSource('PO'); setUsedLine(null); setUsedSearch('')
    setPoOrder(null); setPoQty({}); setPoSeri({}); setDocs([]); setPoPhotos({})
  }, [open])

  function pickSource(s: RiSource) {
    if (s === source) return
    setSource(s); setErr(null)
    // what a picked PO line / used goods filled in goes with it
    setPoOrder(null); setPoQty({}); setPoSeri({})
    if (usedLine) {
      setUsedLine(null)
      setNoPo(''); setVendor(''); setKodeBarang(''); setDeskripsiBarang(''); setSatuan(''); setHargaSatuan(''); setKuantitas(''); setKeterangan('')
    }
    if (s === 'BEKAS') setDivisi('NV')
  }

  function pickUsedLine(l: RiUsedReturnLine) {
    setUsedLine(l)
    setKodeBarang(l.kode_barang ?? ''); setDeskripsiBarang(l.deskripsi ?? ''); setSatuan(l.satuan ?? '')
    setKuantitas(l.qty ?? ''); setKeterangan(`Pengembalian bekas NPBG ${l.npbg_no}`); setDivisi('NV')
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return
    setErr(null)
    const room = MAX_PHOTOS - photos.length
    if (files.length > room) setErr(`Maximum proof photos ${MAX_PHOTOS}. ${room > 0 ? `Only ${room} first photo is used.` : ''}`)
    setReading(true)
    try {
      const made = await Promise.all([...files].slice(0, Math.max(0, room)).map((f) => photoToDataUrl(f, 1600)))
      setPhotos((p) => [...p, ...made].slice(0, MAX_PHOTOS))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setReading(false)
    }
  }

  function pickItem(item: ItemLookupResult) {
    setKodeBarang(item.code)
    setDeskripsiBarang(item.description)
    if (item.unit && !satuan) setSatuan(item.unit)
    setActiveField(null)
  }

  function pickPoOrder(o: RiPoOrder) {
    setPoOrder(o); setPoQty({}); setPoSeri({}); setPoPhotos({}); setDivisi('NA')
  }

  // photos of one PO item (the camera / gallery opened from its row)
  async function addLinePhotos(lineId: number, files: FileList | null) {
    if (!files?.length) return
    setErr(null)
    const room = MAX_PHOTOS - (poPhotos[lineId]?.length ?? 0)
    setReading(true)
    try {
      const made = await Promise.all([...files].slice(0, Math.max(0, room)).map((f) => photoToDataUrl(f, 1600)))
      setPoPhotos((m) => ({ ...m, [lineId]: [...(m[lineId] ?? []), ...made].slice(0, MAX_PHOTOS) }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setReading(false)
    }
  }

  // documents of the delivery (surat jalan / invoice): a photo or a PDF, up to MAX_DOCS
  async function addDocs(files: FileList | null) {
    if (!files?.length) return
    setErr(null)
    const room = MAX_DOCS - docs.length
    const picked = [...files].slice(0, Math.max(0, room))
    const big = picked.find((f) => f.size > 10 * 1024 * 1024)
    if (big) return invalidTo(setErr, `${big.name} more than 10 MB.`)
    setReading(true)
    try {
      const made = await Promise.all(picked.map(async (f) => ({
        name: f.name,
        data: f.type.startsWith('image/') ? await photoToDataUrl(f, 2000) : await new Promise<string>((ok, fail) => {
          const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fail(new Error('The file cannot be read.')); r.readAsDataURL(f)
        }),
      })))
      setDocs((d) => [...d, ...made].slice(0, MAX_DOCS))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setReading(false)
    }
  }

  const typedQty = (id: number) => Number((poQty[id] ?? '').replace(',', '.'))

  // a row per unit of what is arriving; a line with nothing typed yet counts what is left of it
  async function exportPoSerials() {
    if (!poOrder) return
    setErr(null)
    const lines = poOrder.lines.flatMap((l) => {
      const qty = typedQty(l.id) > 0 ? typedQty(l.id) : l.remaining
      return qty > 0 && Number.isInteger(qty) ? [{ key: l.id, kode: l.kode_barang, deskripsi: l.deskripsi, satuan: l.satuan, qty, serials: filledSerials(poSeri[l.id]) }] : []
    })
    if (lines.length === 0) return invalidTo(setErr, 'No item with a whole quantity to export.')
    await downloadRiSerialTemplate(poOrder.number, lines).catch((e) => setErr(apiErrorMessage(e)))
  }

  async function importPoSerials(file: File) {
    if (!poOrder) return
    setErr(null)
    try {
      const read = await importRiSerials(file)
      const open = new Set(poOrder.lines.filter((l) => l.remaining > 0).map((l) => l.id))
      if (read.some((l) => !open.has(l.key))) return invalidTo(setErr, `This file does not match PO ${poOrder.number}. Export it from this PO.`)
      setPoSeri((m) => ({ ...m, ...Object.fromEntries(read.map((l) => [l.key, l.serials])) }))
      // nothing typed yet: what the file holds is what arrived
      setPoQty((q) => ({ ...q, ...Object.fromEntries(read.filter((l) => !q[l.key]?.trim()).map((l) => [l.key, String(l.serials.length)])) }))
      const off = read.find((l) => poQty[l.key]?.trim() && typedQty(l.key) !== l.serials.length)
      setSerialsOpen(off?.key ?? null)
      toast.success(`${read.reduce((n, l) => n + l.serials.length, 0)} serial numbers imported for ${read.length} items.`)
    } catch (e) {
      setErr(apiErrorMessage(e))
    }
  }

  async function exportManualSerials() {
    setErr(null)
    const qty = Number(kuantitas)
    if (!Number.isInteger(qty) || qty <= 0) return invalidTo(setErr, 'Fill in a whole quantity first.')
    await downloadRiSerialTemplate(noSuratJalan.trim() || 'RI', [{ key: MANUAL_KEY, kode: kodeBarang.trim() || null, deskripsi: deskripsiBarang.trim() || null, satuan: satuan.trim() || null, qty, serials: filledSerials(noSeri) }])
      .catch((e) => setErr(apiErrorMessage(e)))
  }

  async function importManualSerials(file: File) {
    setErr(null)
    try {
      const read = await importRiSerials(file)
      if (read.length !== 1 || read[0].key !== MANUAL_KEY) return invalidTo(setErr, 'This file does not match this Receipt. Export it from this form.')
      setNoSeri(read[0].serials)
      if (!kuantitas) setKuantitas(read[0].serials.length)
      toast.success(`${read[0].serials.length} serial numbers imported.`)
    } catch (e) {
      setErr(apiErrorMessage(e))
    }
  }

  function submitFromPo() {
    if (!poOrder) return invalidTo(setErr, 'Find and select the PO first, or change the source to Manual.')
    const lines = poOrder.lines.flatMap((l) => {
      const n = typedQty(l.id)
      return poQty[l.id] && n > 0 ? [{ purchase_order_item_id: l.id, qty: n, serials: filledSerials(poSeri[l.id]), photos: poPhotos[l.id] ?? [] }] : []
    })
    if (Object.values(poQty).some((v) => v.trim() !== '' && !(Number(v.replace(',', '.')) >= 0))) return invalidTo(setErr, 'The received quantity must be a number.')
    if (lines.length === 0) return invalidTo(setErr, 'Fill in the received quantity for at least one item.')
    const noRatio = poOrder.lines.find((l) => typedQty(l.id) > 0 && l.unit_problem)
    if (noRatio) return invalidTo(setErr, `${noRatio.deskripsi}: ${noRatio.unit_problem} Set it in UOM, Per item tab.`)
    for (const l of poOrder.lines) {
      const problem = typedQty(l.id) > 0 ? serialProblem(poSeri[l.id], typedQty(l.id)) : null
      if (problem) { setSerialsOpen(l.id); return invalidTo(setErr, `${l.deskripsi}: ${problem}.`) }
    }
    // the proof is per item
    const noPhoto = lines.find((l) => l.photos.length === 0)
    if (noPhoto) return invalidTo(setErr, `Upload a proof photo for ${poOrder.lines.find((l) => l.id === noPhoto.purchase_order_item_id)?.deskripsi ?? 'items received'}.`)
    const payload: RiFromPoPayload = {
      purchase_order_id: poOrder.id, divisi, no_surat_jalan: noSuratJalan.trim() || null, pemeriksa: pemeriksa.trim() || null,
      tgl_ri: tglRi || null, keterangan: keterangan.trim() || null, lines, documents: docs,
    }
    // never the same delivery twice (two admins, one delivery): the server asks first
    saveOnce(createFromPo.mutate, payload, setCreatedDoc, setErr)
  }

  function submit() {
    setErr(null)
    if (source === 'PO') return submitFromPo()
    if (source === 'BEKAS' && !usedLine) {
      invalidTo(setErr, 'Select the used item returned.')
      return
    }
    if (!deskripsiBarang.trim() || !kuantitas) {
      invalidTo(setErr, 'Item Description and Quantity are required.')
      return
    }
    const serialIssue = serialProblem(noSeri, Number(kuantitas))
    if (serialIssue) {
      invalidTo(setErr, `Serial numbers: ${serialIssue}.`)
      return
    }
    if (photos.length === 0) {
      invalidTo(setErr, 'Upload at least 1 goods receipt proof photo.')
      return
    }
    const payload: RiCreatePayload = {
      divisi,
      vendor: vendor.trim() || null,
      no_po: noPo.trim() || null,
      no_surat_jalan: noSuratJalan.trim() || null,
      kode_barang: kodeBarang.trim() || null,
      deskripsi_barang: deskripsiBarang.trim(),
      kuantitas: Number(kuantitas),
      satuan: satuan.trim() || null,
      harga_satuan: hargaSatuan === '' ? null : Number(hargaSatuan),
      serials: filledSerials(noSeri),
      pemeriksa: pemeriksa.trim() || null,
      tgl_ri: tglRi || null,
      keterangan: keterangan.trim() || null,
      sumber: source,
      used_return_row_id: source === 'BEKAS' ? usedLine?.id ?? null : null,
      photos,
    }
    // never the same document twice (two admins, one request): the server asks first
    saveOnce(create.mutate, payload, setCreatedDoc, setErr)
  }

  if (createdDoc && printing && open) {
    return <PrintDocButton url={`/api/ri/${createdDoc.id}/print`} docType="ri" autoOpen hideTrigger onClosePreview={onClose} />
  }

  if (createdDoc) {
    return (
      <Modal form
        open={open}
        onClose={onClose}
        title="Receipt Saved"
        description={`Receipt No.: ${createdDoc.no_ri}`}
        className="max-w-md"
        footer={<Button size="sm" onClick={onClose}>Done</Button>}
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="size-10 text-emerald-600" />
          <p className="text-sm text-muted-foreground">
            Receipt saved. Print now on the special RI paper.
          </p>
          <Button size="sm" variant="outline" onClick={() => setPrinting(true)}>
            <Printer className="size-4" /> Print
          </Button>
        </div>
      </Modal>
    )
  }

  const waitingLines = poOrder ? poOrder.lines.filter((l) => l.remaining > 0) : []
  const doneCount = poOrder ? poOrder.lines.length - waitingLines.length : 0
  const filledCount = waitingLines.filter((l) => typedQty(l.id) > 0).length
  const detailsNo = 2
  const proofNo = 3

  /** the inputs of one PO line: how many came now, its serials, its proof photos (table row and phone card alike) */
  const lineState = (l: RiPoOrder['lines'][number]) => {
    const typed = poQty[l.id] ?? ''
    const n = Number(typed.replace(',', '.'))
    return {
      typed, n,
      partial: typed !== '' && n > 0 && n + 0.0001 < l.remaining,
      over: typed !== '' && n > l.remaining + 0.0001,
      serialCount: filledSerials(poSeri[l.id]).length,
      serialIssue: typed !== '' && n > 0 ? serialProblem(poSeri[l.id], n) : null,
      needsPhoto: typed !== '' && n > 0 && !(poPhotos[l.id]?.length),
    }
  }
  const qtyInput = (l: RiPoOrder['lines'][number]) => {
    const s = lineState(l)
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Input className="h-9 w-24 bg-card text-right font-semibold tabular-nums" inputMode="decimal" aria-label={`Received ${l.deskripsi}`}
            value={s.typed} placeholder="0" onChange={(e) => setPoQty((q) => ({ ...q, [l.id]: e.target.value }))} />
          <span className="text-xs text-muted-foreground">{l.satuan ?? ''}</span>
        </div>
        {s.n > 0 && l.base_unit && l.unit_ratio !== 1 && <div className="text-[11px] font-medium tabular-nums text-primary">= {fmtQty(Math.round(s.n * l.unit_ratio * 100) / 100)} {l.base_unit} in stock</div>}
        {l.unit_problem && <div className="max-w-[16rem] text-[11px] text-red-600">{l.unit_problem}</div>}
        {s.partial && <div className="text-[11px] text-amber-700">Partial · {fmtQty(Math.round((l.remaining - s.n) * 100) / 100)} still to come</div>}
        {s.over && <div className="text-[11px] text-amber-700">{fmtQty(Math.round((s.n - l.remaining) * 100) / 100)} more than ordered, still goes into stock</div>}
      </div>
    )
  }
  const serialButton = (l: RiPoOrder['lines'][number]) => {
    const s = lineState(l)
    return (
      <button type="button" disabled={!(s.n > 0) && s.serialCount === 0} aria-expanded={serialsOpen === l.id} aria-label={`Serial numbers ${l.deskripsi}`}
        onClick={() => setSerialsOpen(serialsOpen === l.id ? null : l.id)}
        className={cn('inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border bg-card px-2.5 text-xs font-medium tabular-nums disabled:cursor-not-allowed disabled:opacity-40',
          s.serialIssue ? 'border-amber-400 text-amber-700' : s.serialCount > 0 ? 'border-emerald-300 text-emerald-700' : 'text-muted-foreground hover:text-foreground')}>
        SN {s.serialCount}{s.n > 0 && Number.isInteger(s.n) ? `/${fmtQty(s.n)}` : ''}
        <ChevronDown className={cn('size-3.5 transition-transform', serialsOpen === l.id && 'rotate-180')} />
      </button>
    )
  }
  const photoCell = (l: RiPoOrder['lines'][number]) => {
    const s = lineState(l)
    return (
      <div className="flex items-center gap-1.5">
        {(poPhotos[l.id] ?? []).map((p, k) => (
          <div key={k} className="relative size-9 shrink-0 overflow-hidden rounded-md border bg-muted">
            <img src={p} alt={`Photo ${l.deskripsi} ${k + 1}`} className="size-full object-cover" />
            <button type="button" aria-label={`Delete photo ${k + 1}`} onClick={() => setPoPhotos((m) => ({ ...m, [l.id]: (m[l.id] ?? []).filter((_, j) => j !== k) }))}
              className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white"><X className="size-3" /></button>
          </div>
        ))}
        {(poPhotos[l.id]?.length ?? 0) < MAX_PHOTOS && (
          <button type="button" disabled={reading} onClick={() => { setPhotoFor(l.id); linePhotoInput.current?.click() }}
            title={`Proof photo ${l.deskripsi} (max ${MAX_PHOTOS})`} aria-label={`Proof photo ${l.deskripsi}`}
            className={cn('flex size-9 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground hover:border-primary hover:text-primary',
              s.needsPhoto && 'border-amber-400 bg-amber-50 text-amber-600')}>
            <Camera className="size-4" />
          </button>
        )}
      </div>
    )
  }
  const serialPanel = (l: RiPoOrder['lines'][number]) => {
    const s = lineState(l)
    return (
      <div className="rounded-md border bg-muted/30 p-3">
        <RiSerialEntry qty={s.n} value={poSeri[l.id] ?? []} label={l.deskripsi} onChange={(v) => setPoSeri((m) => ({ ...m, [l.id]: v }))} />
        {s.serialIssue && <p className="mt-2 text-xs text-amber-700">{s.serialIssue}</p>}
      </div>
    )
  }

  return (
    <Modal page form
      open={open}
      onClose={onClose}
      title="Add Receipt"
      footer={
        <>
          {source === 'PO' && poOrder && (
            <span className="mr-auto text-xs text-muted-foreground tabular-nums">{filledCount} of {waitingLines.length} items filled</span>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={create.isPending || createFromPo.isPending || reading} onClick={submit}>
            {create.isPending || createFromPo.isPending ? 'Saving…' : 'Save Receipt'}
          </Button>
        </>
      }
    >
      <div className="mx-auto w-full max-w-6xl space-y-5 pb-2">
        {/* where the goods come from */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border bg-muted/40 p-1" role="tablist" aria-label="Receipt Source">
            {(['PO', 'BEKAS', 'MANUAL'] as RiSource[]).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={source === s} onClick={() => pickSource(s)}
                className={cn('rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors', source === s ? 'bg-card text-primary shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
                {RI_SOURCE[s]}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {source === 'PO' ? 'Goods of a STOCKWISE PO arriving, in part or in full.' : source === 'BEKAS' ? 'A used item coming back from a Delivery Order.' : 'Any item, not tied to a PO.'}
          </p>
        </div>

        {/* 1 — the PO and its items */}
        {source === 'PO' && (
          <Section n={1} title={poOrder ? 'Items arriving' : 'Select the PO'}
            aside={poOrder && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" className="h-8" onClick={() => setPoQty(Object.fromEntries(waitingLines.map((l) => [l.id, String(l.remaining)])))}>Fill all remaining</Button>
                <RiSerialExcelButtons onExport={exportPoSerials} onImport={importPoSerials} />
              </div>
            )}>
            {poOrder ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
                  <div><div className="text-xs text-muted-foreground">PO</div><div className="font-semibold">{poOrder.number}</div></div>
                  <div className="min-w-0"><div className="text-xs text-muted-foreground">Vendor</div><div className="truncate">{poOrder.vendor ?? '—'}</div></div>
                  <div><div className="text-xs text-muted-foreground">PO date</div><div>{poOrder.date ? new Date(poOrder.date).toLocaleDateString('en-GB') : '—'}</div></div>
                  <div><div className="text-xs text-muted-foreground">Waiting</div><div className="tabular-nums">{waitingLines.length} item{waitingLines.length === 1 ? '' : 's'}</div></div>
                  <Button size="sm" variant="ghost" className="ml-auto h-8" onClick={() => { setPoOrder(null); setPoQty({}); setPoSeri({}); setPoPhotos({}) }}>Change PO</Button>
                </div>

                {/* wide screen: one table, nothing to scroll sideways */}
                <div className="hidden overflow-hidden rounded-lg border md:block">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="w-10 px-3 py-2.5 text-center font-medium">#</th>
                        <th className="px-3 py-2.5 font-medium">Item</th>
                        <th className="w-40 px-3 py-2.5 text-right font-medium">Ordered · Received</th>
                        <th className="w-24 px-3 py-2.5 text-right font-medium">Balance</th>
                        <th className="w-52 bg-primary/5 px-3 py-2.5 font-semibold text-primary">Received now</th>
                        <th className="w-28 px-3 py-2.5 font-medium">Serial No.</th>
                        <th className="w-40 px-3 py-2.5 font-medium">Proof photo *</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {waitingLines.map((l, i) => (
                        <Fragment key={l.id}>
                          <tr className="align-top hover:bg-muted/20">
                            <td className="px-3 py-3 text-center tabular-nums text-muted-foreground">{i + 1}</td>
                            <td className="px-3 py-3">
                              <div className="font-medium leading-snug">{l.deskripsi}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">{[l.kode_barang, l.no_ppb].filter(Boolean).join(' · ')}</div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-muted-foreground">{fmtQty(l.qty)} · {fmtQty(l.received)}</td>
                            <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">{fmtQty(l.remaining)} <span className="text-xs font-normal text-muted-foreground">{l.satuan ?? ''}</span></td>
                            <td className="bg-primary/5 px-3 py-2">{qtyInput(l)}</td>
                            <td className="px-3 py-2">{serialButton(l)}</td>
                            <td className="px-3 py-2">{photoCell(l)}</td>
                          </tr>
                          {serialsOpen === l.id && (
                            <tr><td colSpan={7} className="px-3 pb-3">{serialPanel(l)}</td></tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* phone: one card per item */}
                <div className="space-y-2 md:hidden">
                  {waitingLines.map((l, i) => (
                    <div key={l.id} className="space-y-3 rounded-lg border bg-card p-3">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium leading-snug">{l.deskripsi}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{[l.kode_barang, l.no_ppb].filter(Boolean).join(' · ')}</div>
                          <div className="mt-1 text-xs tabular-nums text-muted-foreground">Ordered {fmtQty(l.qty)} · received {fmtQty(l.received)} · <span className="font-semibold text-foreground">balance {fmtQty(l.remaining)} {l.satuan ?? ''}</span></div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-start gap-3 pl-7">
                        {qtyInput(l)}
                        {serialButton(l)}
                        {photoCell(l)}
                      </div>
                      {serialsOpen === l.id && serialPanel(l)}
                    </div>
                  ))}
                </div>

                {doneCount > 0 && <p className="text-xs text-muted-foreground">{doneCount} other item{doneCount > 1 ? 's' : ''} of this PO already fully received.</p>}
                <input ref={linePhotoInput} type="file" accept="image/*" capture="environment" multiple className="hidden"
                  onChange={(e) => { if (photoFor != null) void addLinePhotos(photoFor, e.target.files); e.target.value = '' }} />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-9" value={poSearch} onChange={(e) => setPoSearch(e.target.value)} placeholder="Search PO no., vendor, or an item still to come" aria-label="Search PO" />
                </div>
                {poOrders.isLoading && <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading POs…</p>}
                {poOrders.data && poOrders.data.length === 0 && <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No PO is waiting for goods.</p>}
                {(poOrders.data?.length ?? 0) > 0 && (
                  <ul className="max-h-[50vh] divide-y overflow-auto rounded-lg border bg-card">
                    {poOrders.data!.map((o) => {
                      const waiting = o.lines.filter((l) => l.remaining > 0)
                      return (
                        <li key={o.id}>
                          <button type="button" className="flex w-full items-start gap-4 px-4 py-3 text-left hover:bg-primary/5" onClick={() => pickPoOrder(o)}>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-semibold">{o.number}</span>
                                {o.vendor && <span className="text-sm text-muted-foreground">{o.vendor}</span>}
                              </div>
                              <div className="mt-0.5 truncate text-xs text-muted-foreground">{waiting.map((l) => `${l.deskripsi} (${fmtQty(l.remaining)})`).join(', ')}</div>
                            </div>
                            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium tabular-nums text-primary">{waiting.length} item{waiting.length === 1 ? '' : 's'}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </Section>
        )}

        {/* 1 — the used item coming back */}
        {source === 'BEKAS' && (
          <Section n={1} title="Used item returned">
            {usedLine ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{usedLine.deskripsi}</div>
                  <div className="text-xs text-muted-foreground">{[usedLine.npbg_no, `${usedLine.qty ?? ''} ${usedLine.satuan ?? ''}`.trim(), usedLine.pelanggan].filter(Boolean).join(' · ')}</div>
                </div>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setUsedLine(null)}>Change</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-9" value={usedSearch} onChange={(e) => setUsedSearch(e.target.value)} placeholder="Search Delivery Order no., item, customer / plate no." aria-label="Search used item" />
                </div>
                {usedLines.data && usedLines.data.length === 0 && <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No used item is waiting to come back.</p>}
                {(usedLines.data?.length ?? 0) > 0 && (
                  <ul className="max-h-[40vh] divide-y overflow-auto rounded-lg border bg-card text-sm">
                    {usedLines.data!.map((l) => (
                      <li key={l.id}>
                        <button type="button" className="block w-full px-4 py-2.5 text-left hover:bg-primary/5" onClick={() => pickUsedLine(l)}>
                          <div className="font-medium">{l.deskripsi}</div>
                          <div className="text-xs text-muted-foreground">{[l.npbg_no, `${l.qty ?? ''} ${l.satuan ?? ''}`.trim(), l.pelanggan].filter(Boolean).join(' · ')}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Section>
        )}

        {/* 1 — any item (manual) / the used item's quantity */}
        {source !== 'PO' && (source === 'MANUAL' || usedLine) && (
          <Section n={source === 'MANUAL' ? 1 : undefined} title={source === 'MANUAL' ? 'Item received' : 'Item details'}
            aside={<RiSerialExcelButtons onExport={exportManualSerials} onImport={importManualSerials} />}>
            <div className="grid gap-3 sm:grid-cols-6">
              <Field label="Item Code" className="relative sm:col-span-2">
                <Input value={kodeBarang} onChange={(e) => setKodeBarang(e.target.value)} placeholder="e.g. PUI.0019"
                  onFocus={() => setActiveField('kode')} onBlur={() => setTimeout(() => setActiveField((f) => (f === 'kode' ? null : f)), 150)} />
                {activeField === 'kode' && kodeBarang.trim().length >= 2 && <ItemSuggestions items={suggestions} loading={searchingItems} onPick={pickItem} />}
              </Field>
              <Field label="Item Description *" className="relative sm:col-span-4">
                <Input value={deskripsiBarang} onChange={(e) => setDeskripsiBarang(e.target.value)} placeholder="Type to search the Product Master"
                  onFocus={() => setActiveField('deskripsi')} onBlur={() => setTimeout(() => setActiveField((f) => (f === 'deskripsi' ? null : f)), 150)} />
                {activeField === 'deskripsi' && deskripsiBarang.trim().length >= 2 && <ItemSuggestions items={suggestions} loading={searchingItems} onPick={pickItem} />}
              </Field>
              <Field label="Quantity *" className="sm:col-span-2">
                <Input type="number" min={0} step="0.01" className="tabular-nums" value={kuantitas} onChange={(e) => setKuantitas(e.target.value ? Number(e.target.value) : '')} />
              </Field>
              <Field label="Unit" className="sm:col-span-2">
                <Input value={satuan} onChange={(e) => setSatuan(e.target.value)} placeholder="PCS, SET, …" />
              </Field>
              <Field label="Unit Price" className="sm:col-span-2">
                <Input type="number" min={0} className="tabular-nums" value={hargaSatuan} onChange={(e) => setHargaSatuan(e.target.value ? Number(e.target.value) : '')} />
              </Field>
            </div>
            <div className="mt-4 space-y-2">
              <div className="text-sm font-medium">Serial No. <span className="font-normal tabular-nums text-muted-foreground">{filledSerials(noSeri).length}{Number.isInteger(Number(kuantitas)) && Number(kuantitas) > 0 ? ` of ${Number(kuantitas)}` : ''} · only for items with serial numbers</span></div>
              <RiSerialEntry qty={Number(kuantitas)} value={noSeri} onChange={setNoSeri} label="Item" />
            </div>
          </Section>
        )}

        {/* 2 — the receipt itself */}
        <Section n={detailsNo} title="Receipt details">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Receipt type">
              <Select value={divisi} onChange={(e) => setDivisi(e.target.value as 'NA' | 'ATK' | 'NV')}>
                {JENIS_RI.map((d) => <option key={d} value={d}>{riJenis(d)}</option>)}
              </Select>
            </Field>
            <Field label="Receipt date"><Input type="date" value={tglRi} onChange={(e) => setTglRi(e.target.value)} /></Field>
            <Field label="Delivery note no."><Input value={noSuratJalan} onChange={(e) => setNoSuratJalan(e.target.value)} /></Field>
            <Field label="Inspector"><Input value={pemeriksa} onChange={(e) => setPemeriksa(e.target.value)} /></Field>
            {source !== 'PO' && <>
              <Field label="Vendor" className="lg:col-span-2"><Input value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>
              <Field label="PO no. (reference)" className="lg:col-span-2"><Input value={noPo} onChange={(e) => setNoPo(e.target.value)} /></Field>
            </>}
            <Field label="Remarks" className="sm:col-span-2 lg:col-span-4"><Input value={keterangan} onChange={(e) => setKeterangan(e.target.value)} /></Field>
          </div>
        </Section>

        {/* 3 — the proof */}
        {source === 'PO' ? (
          <Section n={proofNo} title="Documents" hint={`Delivery note / invoice, photo or PDF, up to ${MAX_DOCS}. The proof photo of each item is in its row above.`}>
            <input ref={docInput} type="file" accept="image/*,application/pdf" multiple className="hidden"
              onChange={(e) => { void addDocs(e.target.files); e.target.value = '' }} />
            <div className="flex flex-wrap gap-2">
              {docs.map((d, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs">
                  <FileText className="size-3.5 text-muted-foreground" /> <span className="max-w-[14rem] truncate">{d.name}</span>
                  <button type="button" aria-label={`Delete ${d.name}`} onClick={() => setDocs((x) => x.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>
                </span>
              ))}
              {docs.length < MAX_DOCS && (
                <Button type="button" size="sm" variant="outline" className="h-8" disabled={reading} onClick={() => docInput.current?.click()}>
                  <Upload className="size-3.5" /> Upload document
                </Button>
              )}
            </div>
          </Section>
        ) : (
          <Section n={proofNo} title="Proof photo *" hint={`At least 1, up to ${MAX_PHOTOS}.`}>
            <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple className="hidden"
              onChange={(e) => { void addPhotos(e.target.files); e.target.value = '' }} />
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {photos.map((p, i) => (
                <div key={i} className="relative overflow-hidden rounded-lg border bg-muted">
                  <img src={p} alt={`Proof photo ${i + 1}`} className="aspect-square w-full object-cover" />
                  <button type="button" aria-label={`Delete photo ${i + 1}`} onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"><X className="size-3.5" /></button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button type="button" onClick={() => photoInput.current?.click()} disabled={reading}
                  className={cn('flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-xs text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary',
                    photos.length === 0 && 'border-amber-400')}>
                  {reading ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-6" />}
                  <span className="font-medium">{reading ? 'Processing…' : photos.length === 0 ? 'Take / select' : 'Add photo'}</span>
                  <span>{photos.length}/{MAX_PHOTOS}</span>
                </button>
              )}
            </div>
          </Section>
        )}

        {err && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      </div>
    </Modal>
  )
}

/** One numbered part of the form: a plain heading, then its fields. */
function Section({ n, title, hint, aside, children }: { n?: number; title: string; hint?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {n != null && <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{n}</span>}
          <div>
            <h3 className="text-[15px] font-semibold leading-6">{title}</h3>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label>{label}</Label>
      {children}
    </div>
  )
}
