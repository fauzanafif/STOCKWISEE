import { Fragment, useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, ChevronDown, FileText, Loader2, Printer, Upload, X } from 'lucide-react'
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

  return (
    <Modal page form
      open={open}
      onClose={onClose}
      title="Add Receipt"
      description="Receipts recorded directly in Stockwise: from a PO, used-item return, or manual (any item)."
      // "From PO" holds the PO's whole item table: a wide popup
      className={source === 'PO' && poOrder ? 'max-w-6xl' : 'max-w-2xl'}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={create.isPending || createFromPo.isPending || reading} onClick={submit}>
            {create.isPending || createFromPo.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Receipt Source</Label>
          <div className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1" role="tablist" aria-label="Receipt Source">
            {(['PO', 'BEKAS', 'MANUAL'] as RiSource[]).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={source === s} onClick={() => pickSource(s)}
                className={cn('rounded-md px-2 py-1.5 text-sm font-medium transition-colors', source === s ? 'bg-card text-primary ring-1 ring-border' : 'text-muted-foreground hover:text-foreground')}>
                {RI_SOURCE[s]}
              </button>
            ))}
          </div>
        </div>

        {source === 'BEKAS' && (
          <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
            <Label>Used item returned *</Label>
            {usedLine ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0"><span className="">{usedLine.npbg_no}</span> · {usedLine.deskripsi} · {usedLine.qty ?? ''} {usedLine.satuan ?? ''}{usedLine.pelanggan ? ` · ${usedLine.pelanggan}` : ''}</span>
                <Button size="sm" variant="ghost" onClick={() => setUsedLine(null)}>Release</Button>
              </div>
            ) : (
              <>
                <Input value={usedSearch} onChange={(e) => setUsedSearch(e.target.value)} placeholder="Search Delivery Order no., item, customer / plate no." />
                {usedLines.data && usedLines.data.length === 0 && <p className="text-xs text-muted-foreground">No used items waiting to be returned.</p>}
                {(usedLines.data?.length ?? 0) > 0 && (
                  <ul className="max-h-40 divide-y overflow-auto rounded-md border bg-card text-sm">
                    {usedLines.data!.map((l) => (
                      <li key={l.id}>
                        <button type="button" className="block w-full px-3 py-2 text-left hover:bg-muted" onClick={() => pickUsedLine(l)}>
                          <span className="text-[13px]">{l.npbg_no}</span> {l.deskripsi}
                          <span className="text-muted-foreground"> · {l.qty ?? ''} {l.satuan ?? ''}{l.pelanggan ? ` · ${l.pelanggan}` : ''}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {/* from a STOCKWISE PO: search the PO, its whole item list, how much of each arrived (part is fine) */}
        {source === 'PO' && (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <Label>PO STOCKWISE *</Label>
            {poOrder ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0"><span className=" font-semibold">{poOrder.number}</span>{poOrder.vendor ? ` · ${poOrder.vendor}` : ''}{poOrder.date ? ` · ${new Date(poOrder.date).toLocaleDateString('en-GB')}` : ''}</span>
                  <Button size="sm" variant="ghost" onClick={() => { setPoOrder(null); setPoQty({}); setPoSeri({}) }}>Change PO</Button>
                </div>
                <div className="max-h-[55vh] overflow-auto rounded-lg border bg-card">
                  <table className="w-full min-w-[1200px] text-sm">
                    <thead className="sticky top-0 z-10 whitespace-nowrap border-b bg-muted text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="w-10 px-3 py-2.5 text-center font-medium">No</th>
                        <th className="px-3 py-2.5 font-medium">Code</th>
                        <th className="min-w-[16rem] px-3 py-2.5 font-medium">Item Description</th>
                        <th className="px-3 py-2.5 font-medium">Vendor</th>
                        <th className="px-3 py-2.5 font-medium">Unit</th>
                        <th className="px-3 py-2.5 font-medium">Purchase Request No.</th>
                        <th className="px-3 py-2.5 text-right font-medium">Qty PO</th>
                        <th className="px-3 py-2.5 text-right font-medium">Received</th>
                        <th className="px-3 py-2.5 text-right font-medium">Balance</th>
                        <th className="px-3 py-2.5 text-right font-medium">Price</th>
                        <th className="bg-primary/10 px-3 py-2.5 text-right font-semibold text-primary">Received Now</th>
                        <th className="px-3 py-2.5 font-medium">Serial No.</th>
                        <th className="px-3 py-2.5 font-medium">Proof Photo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {poOrder.lines.map((l, i) => {
                        const done = l.remaining <= 0
                        const typed = poQty[l.id] ?? ''
                        const n = Number(typed.replace(',', '.'))
                        const partial = typed !== '' && n > 0 && n + 0.0001 < l.remaining
                        const serialCount = filledSerials(poSeri[l.id]).length
                        const serialIssue = typed !== '' && n > 0 ? serialProblem(poSeri[l.id], n) : null
                        return (
                          <Fragment key={l.id}>
                          <tr className={cn('align-top', done ? 'bg-muted/40 text-muted-foreground' : 'even:bg-muted/20 hover:bg-primary/5')}>
                            <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">{i + 1}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-[13px]">{l.kode_barang ?? ''}</td>
                            <td className="px-3 py-2.5 font-medium">{l.deskripsi}</td>
                            <td className="px-3 py-2.5">{l.vendor ?? ''}</td>
                            <td className="whitespace-nowrap px-3 py-2.5">{l.satuan ?? ''}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-[13px]">{l.no_ppb ?? ''}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{fmtQty(l.qty)}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{fmtQty(l.received)}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">
                              {done ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">Done</span> : fmtQty(l.remaining)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{l.unit_price ? l.unit_price.toLocaleString('id-ID') : ''}</td>
                            <td className="bg-primary/5 px-3 py-2 text-right">
                              {!done && (
                                <>
                                  <Input className="ml-auto h-9 w-24 bg-card text-right font-semibold tabular-nums" inputMode="decimal" aria-label={`Received ${l.deskripsi}`}
                                    value={typed} placeholder="0" onChange={(e) => setPoQty((q) => ({ ...q, [l.id]: e.target.value }))} />
                                  {n > 0 && l.base_unit && <div className="mt-1 whitespace-nowrap text-[11px] font-medium tabular-nums text-primary">= {fmtQty(Math.round(n * l.unit_ratio * 100) / 100)} {l.base_unit} in stock</div>}
                                  {l.unit_problem && <div className="mt-1 max-w-[14rem] whitespace-normal text-left text-[11px] text-red-600">{l.unit_problem}</div>}
                                  {partial && <div className="mt-1 whitespace-nowrap text-[11px] text-amber-700">partial, balance {fmtQty(Math.round((l.remaining - n) * 100) / 100)}</div>}
                                  {typed !== '' && n > l.remaining + 0.0001 && <div className="mt-1 whitespace-nowrap text-[11px] text-amber-700">more {fmtQty(Math.round((n - l.remaining) * 100) / 100)}, still goes into stock</div>}
                                </>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {!done && (
                                <button type="button" disabled={!(n > 0) && serialCount === 0} aria-expanded={serialsOpen === l.id} aria-label={`Serial numbers ${l.deskripsi}`}
                                  onClick={() => setSerialsOpen(serialsOpen === l.id ? null : l.id)}
                                  className={cn('inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-md border bg-card px-2.5 text-xs font-medium tabular-nums disabled:cursor-not-allowed disabled:opacity-50',
                                    serialIssue ? 'border-amber-400 text-amber-700' : serialCount > 0 ? 'border-emerald-300 text-emerald-700' : 'text-muted-foreground hover:text-foreground')}>
                                  {serialCount}{n > 0 && Number.isInteger(n) ? `/${fmtQty(n)}` : ''}
                                  <ChevronDown className={cn('size-3.5 transition-transform', serialsOpen === l.id && 'rotate-180')} />
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {!done && (
                                <div className="flex items-center gap-1.5">
                                  {(poPhotos[l.id] ?? []).map((p, k) => (
                                    <div key={k} className="relative size-10 shrink-0 overflow-hidden rounded border bg-muted">
                                      <img src={p} alt={`Photo ${l.deskripsi} ${k + 1}`} className="size-full object-cover" />
                                      <button type="button" aria-label={`Delete photo ${k + 1}`} onClick={() => setPoPhotos((m) => ({ ...m, [l.id]: (m[l.id] ?? []).filter((_, j) => j !== k) }))}
                                        className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white"><X className="size-3" /></button>
                                    </div>
                                  ))}
                                  {(poPhotos[l.id]?.length ?? 0) < MAX_PHOTOS && (
                                    <button type="button" disabled={reading} onClick={() => { setPhotoFor(l.id); linePhotoInput.current?.click() }}
                                      title={`Proof photo ${l.deskripsi} (maks ${MAX_PHOTOS})`}
                                      className={cn('flex size-10 shrink-0 items-center justify-center rounded border-2 border-dashed text-muted-foreground hover:border-primary hover:text-primary',
                                        typed !== '' && n > 0 && !(poPhotos[l.id]?.length) && 'border-amber-400 text-amber-600')}>
                                      <Camera className="size-4" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                          {serialsOpen === l.id && !done && (
                            <tr className="bg-muted/30">
                              <td colSpan={13} className="px-3 py-3">
                                <RiSerialEntry qty={n} value={poSeri[l.id] ?? []} label={l.deskripsi} onChange={(v) => setPoSeri((m) => ({ ...m, [l.id]: v }))} />
                                {serialIssue && <p className="mt-2 text-xs text-amber-700">{serialIssue}</p>}
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <input ref={linePhotoInput} type="file" accept="image/*" capture="environment" multiple className="hidden"
                    onChange={(e) => { if (photoFor != null) void addLinePhotos(photoFor, e.target.files); e.target.value = '' }} />
                  <Button size="sm" variant="outline" className="h-7" onClick={() => setPoQty(Object.fromEntries(poOrder.lines.filter((l) => l.remaining > 0).map((l) => [l.id, String(l.remaining)])))}>Fill all remaining</Button>
                  <RiSerialExcelButtons onExport={exportPoSerials} onImport={importPoSerials} />
                </div>
              </>
            ) : (
              <>
                <Input value={poSearch} onChange={(e) => setPoSearch(e.target.value)} placeholder="Search PO no., vendor, or items not yet received" />
                {poOrders.data && poOrders.data.length === 0 && <p className="text-xs text-muted-foreground">No POs are waiting for items.</p>}
                {(poOrders.data?.length ?? 0) > 0 && (
                  <ul className="max-h-56 divide-y overflow-auto rounded-md border bg-card text-sm">
                    {poOrders.data!.map((o) => (
                      <li key={o.id}>
                        <button type="button" className="block w-full px-3 py-2 text-left hover:bg-muted" onClick={() => pickPoOrder(o)}>
                          <span className="text-[13px] font-semibold">{o.number}</span>{o.vendor ? ` · ${o.vendor}` : ''}
                          <span className="block truncate text-xs text-muted-foreground">
                            {o.lines.filter((l) => l.remaining > 0).length} items waiting: {o.lines.filter((l) => l.remaining > 0).map((l) => `${l.deskripsi} (${fmtQty(l.remaining)})`).join(', ')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Receipt type</Label>
            <Select value={divisi} onChange={(e) => setDivisi(e.target.value as 'NA' | 'ATK' | 'NV')}>
              {JENIS_RI.map((d) => <option key={d} value={d}>{riJenis(d)}</option>)}
            </Select>
          </div>
          {source !== 'PO' && (
          <div className="space-y-1.5">
            <Label>Vendor</Label>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>
          )}
          <div className="space-y-1.5">
            <Label>Receipt Date</Label>
            <Input type="date" value={tglRi} onChange={(e) => setTglRi(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {source !== 'PO' && (
          <div className="space-y-1.5">
            <Label>PO No. (reference)</Label>
            <Input className="" value={noPo} onChange={(e) => setNoPo(e.target.value)} />
          </div>
          )}
          <div className="space-y-1.5">
            <Label>Delivery Note No.</Label>
            <Input value={noSuratJalan} onChange={(e) => setNoSuratJalan(e.target.value)} />
          </div>
          {source === 'PO' && (
            <div className="space-y-1.5">
              <Label>Inspector</Label>
              <Input value={pemeriksa} onChange={(e) => setPemeriksa(e.target.value)} />
            </div>
          )}
        </div>

        {source !== 'PO' && <>

        <div className="grid grid-cols-2 gap-3">
          <div className="relative space-y-1.5">
            <Label>Item Code</Label>
            <Input
              className=""
              value={kodeBarang}
              onChange={(e) => setKodeBarang(e.target.value)}
              onFocus={() => setActiveField('kode')}
              onBlur={() => setTimeout(() => setActiveField((f) => (f === 'kode' ? null : f)), 150)}
              placeholder="e.g. PUI.0019"
            />
            {activeField === 'kode' && kodeBarang.trim().length >= 2 && (
              <ItemSuggestions items={suggestions} loading={searchingItems} onPick={pickItem} />
            )}
          </div>
          <div className="relative space-y-1.5">
            <Label>Item Description</Label>
            <Input
              value={deskripsiBarang}
              onChange={(e) => setDeskripsiBarang(e.target.value)}
              onFocus={() => setActiveField('deskripsi')}
              onBlur={() => setTimeout(() => setActiveField((f) => (f === 'deskripsi' ? null : f)), 150)}
            />
            {activeField === 'deskripsi' && deskripsiBarang.trim().length >= 2 && (
              <ItemSuggestions items={suggestions} loading={searchingItems} onPick={pickItem} />
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Quantity</Label>
            <Input type="number" min={0} step="0.01" value={kuantitas} onChange={(e) => setKuantitas(e.target.value ? Number(e.target.value) : '')} />
          </div>
          <div className="space-y-1.5">
            <Label>Unit</Label>
            <Input value={satuan} onChange={(e) => setSatuan(e.target.value)} placeholder="PCS, SET, …" />
          </div>
          <div className="space-y-1.5">
            <Label>Unit Price</Label>
            <Input type="number" min={0} value={hargaSatuan} onChange={(e) => setHargaSatuan(e.target.value ? Number(e.target.value) : '')} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Inspector</Label>
          <Input value={pemeriksa} onChange={(e) => setPemeriksa(e.target.value)} />
        </div>

        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Serial No. <span className="font-normal tabular-nums text-muted-foreground">{filledSerials(noSeri).length}{Number.isInteger(Number(kuantitas)) && Number(kuantitas) > 0 ? `/${Number(kuantitas)}` : ''}</span></Label>
            <RiSerialExcelButtons onExport={exportManualSerials} onImport={importManualSerials} />
          </div>
          <RiSerialEntry qty={Number(kuantitas)} value={noSeri} onChange={setNoSeri} label="Item" />
        </div>

        </>}

        <div className="space-y-1.5">
          <Label>Remarks</Label>
          <Input value={keterangan} onChange={(e) => setKeterangan(e.target.value)} />
        </div>

        {source !== 'PO' && (
        <div className="space-y-1.5">
          <Label>Receipt proof photo * <span className="font-normal text-muted-foreground">(minimum 1, maximum {MAX_PHOTOS})</span></Label>
          <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple className="hidden"
            onChange={(e) => { void addPhotos(e.target.files); e.target.value = '' }} />
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative overflow-hidden rounded-lg border bg-muted">
                <img src={p} alt={`Proof photo ${i + 1}`} className="aspect-square w-full object-cover" />
                <button type="button" aria-label={`Delete photo ${i + 1}`} onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"><X className="size-3.5" /></button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button type="button" onClick={() => photoInput.current?.click()} disabled={reading}
                className={'flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-xs text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary'
                  + (photos.length === 0 ? ' border-amber-400' : '')}>
                {reading ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-6" />}
                <span className="font-medium">{reading ? 'Processing…' : photos.length === 0 ? 'Take / select photo' : 'Add photo'}</span>
                <span>{photos.length}/{MAX_PHOTOS}</span>
              </button>
            )}
          </div>
        </div>
        )}

        {source === 'PO' && (
          <div className="space-y-1.5">
            <Label>Document <span className="font-normal text-muted-foreground">(delivery note / invoice, photo or PDF, maximum {MAX_DOCS})</span></Label>
            <input ref={docInput} type="file" accept="image/*,application/pdf" multiple className="hidden"
              onChange={(e) => { void addDocs(e.target.files); e.target.value = '' }} />
            <div className="flex flex-wrap gap-2">
              {docs.map((d, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs">
                  <FileText className="size-3.5 text-muted-foreground" /> <span className="max-w-[12rem] truncate">{d.name}</span>
                  <button type="button" aria-label={`Delete ${d.name}`} onClick={() => setDocs((x) => x.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>
                </span>
              ))}
              {docs.length < MAX_DOCS && (
                <Button type="button" size="sm" variant="outline" className="h-8" disabled={reading} onClick={() => docInput.current?.click()}>
                  <Upload className="size-3.5" /> Upload document
                </Button>
              )}
            </div>
          </div>
        )}

        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}
