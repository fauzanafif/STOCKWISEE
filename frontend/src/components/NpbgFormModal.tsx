import { useEffect, useState } from 'react'
import { CheckCircle2, Printer } from 'lucide-react'
import { useCreateNpbg, useNpbgKlasifikasi, type Npbg, type NpbgCreatePayload } from '@/features/npbg/api'
import { useItemLookup, type ItemLookupResult } from '@/features/inventory/api'
import { saveOnce } from '@/lib/duplicate'
import { useAuth } from '@/auth/AuthContext'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { UomEquivalent } from '@/components/UomEquivalent'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { PrintDocButton } from '@/components/PrintDocButton'

interface Props {
  open: boolean
  onClose: () => void
}

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
 * Form "Tambah NPBG" — untuk goods-out yang dicatat manual di Stockwise, bukan
 * hasil Sync Accurate. Kode Barang & Deskripsi Barang saling mengisi otomatis:
 * ketik salah satu, lalu pilih dari saran, dan keduanya terisi sekaligus.
 */
export function NpbgFormModal({ open, onClose }: Props) {
  const create = useCreateNpbg()
  const klasifikasiOptions = useNpbgKlasifikasi()

  const [pelanggan, setPelanggan] = useState('')
  const [alamatKirim, setAlamatKirim] = useState('')
  const [divisi, setDivisi] = useState('')
  const [tipeNpbg, setTipeNpbg] = useState<'Penjualan' | 'Non Penjualan'>('Penjualan')
  const [klasifikasi, setKlasifikasi] = useState('')
  const [kodeBarang, setKodeBarang] = useState('')
  const [deskripsiBarang, setDeskripsiBarang] = useState('')
  const [activeField, setActiveField] = useState<'kode' | 'deskripsi' | null>(null)
  const [kuantitas, setKuantitas] = useState<number | ''>('')
  const [satuan, setSatuan] = useState('')
  const [noSeri, setNoSeri] = useState('')
  const [peminta, setPeminta] = useState('')
  const [tglNpbg, setTglNpbg] = useState('')
  const [catatan, setCatatan] = useState('')
  const [keterangan, setKeterangan] = useState('')
  const [kembaliBekas, setKembaliBekas] = useState(false)
  const { hasPermission } = useAuth()
  const [err, setErr] = useState<string | null>(null)
  const [createdDoc, setCreatedDoc] = useState<Npbg | null>(null)
  // success screen -> print preview (replaces it, never stacked on / inside it)
  const [printing, setPrinting] = useState(false)

  const lookupQuery = activeField === 'kode' ? kodeBarang : activeField === 'deskripsi' ? deskripsiBarang : ''
  const { data: suggestions, isFetching: searchingItems } = useItemLookup(lookupQuery)

  useEffect(() => {
    if (!open) return
    setPelanggan(''); setAlamatKirim(''); setDivisi(''); setTipeNpbg('Penjualan'); setKlasifikasi('')
    setKodeBarang(''); setDeskripsiBarang(''); setActiveField(null)
    setKuantitas(''); setSatuan(''); setNoSeri(''); setPeminta('')
    setTglNpbg(new Date().toISOString().slice(0, 10))
    setCatatan(''); setKeterangan(''); setKembaliBekas(false); setErr(null); setCreatedDoc(null); setPrinting(false)
  }, [open])

  function pickItem(item: ItemLookupResult) {
    setKodeBarang(item.code)
    setDeskripsiBarang(item.description)
    if (item.unit && !satuan) setSatuan(item.unit)
    setActiveField(null)
  }

  function submit() {
    setErr(null)
    if (!pelanggan.trim() || !deskripsiBarang.trim() || !kuantitas) {
      setErr('Customer, Item Description, and Quantity are required.')
      return
    }
    const payload: NpbgCreatePayload = {
      pelanggan: pelanggan.trim(),
      alamat_kirim: alamatKirim.trim() || null,
      divisi: divisi.trim() || null,
      tipe_npbg: tipeNpbg,
      klasifikasi: klasifikasi.trim() || null,
      kode_barang: kodeBarang.trim() || null,
      deskripsi_barang: deskripsiBarang.trim(),
      kuantitas: Number(kuantitas),
      satuan: satuan.trim() || null,
      no_seri: noSeri.trim() || null,
      peminta: peminta.trim() || null,
      deskripsi: catatan.trim() || null,
      keterangan: keterangan.trim() || null,
      tgl_npbg: tglNpbg || null,
      kembali_bekas: kembaliBekas,
    }
    // never the same document twice (two admins, one request): the server asks first
    saveOnce(create.mutate, payload, setCreatedDoc, setErr)
  }

  if (createdDoc && printing && open) {
    return <PrintDocButton url={`/api/npbg/${createdDoc.id}/print`} docType="npbg" autoOpen hideTrigger onClosePreview={onClose} />
  }

  if (createdDoc) {
    return (
      <Modal form
        open={open}
        onClose={onClose}
        title="Delivery Order Saved"
        description={`Delivery Order No.: ${createdDoc.no_npbg}`}
        className="max-w-md"
        footer={<Button size="sm" onClick={onClose}>Done</Button>}
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="size-10 text-emerald-600" />
          <p className="text-sm text-muted-foreground">
            Delivery Order saved. Print now on the special NPBG paper.
          </p>
          {createdDoc.kembali_bekas && (
            <p className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800">Return used item — already in Used Item Return Tracking.</p>
          )}
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
      title="Add Delivery Order"
      description="Manual Delivery Order; recorded directly in Stockwise, not from Accurate Sync."
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={create.isPending} onClick={submit}>
            {create.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Input value={pelanggan} onChange={(e) => setPelanggan(e.target.value)} placeholder="Customer name" />
          </div>
          <div className="space-y-1.5">
            <Label>Shipping Address</Label>
            <Input value={alamatKirim} onChange={(e) => setAlamatKirim(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Requesting Division</Label>
            <Input value={divisi} onChange={(e) => setDivisi(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Delivery Order Type</Label>
            <Select value={tipeNpbg} onChange={(e) => setTipeNpbg(e.target.value as 'Penjualan' | 'Non Penjualan')}>
              <option value="Penjualan">Penjualan</option>
              <option value="Non Penjualan">Non Penjualan</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Classification</Label>
            <Input value={klasifikasi} onChange={(e) => setKlasifikasi(e.target.value)} list="npbg-klasifikasi-options" placeholder="e.g. GENERAL, PROJECT" />
            <datalist id="npbg-klasifikasi-options">
              {(klasifikasiOptions.data ?? []).map((k) => <option key={k} value={k} />)}
            </datalist>
          </div>
        </div>

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
            <UomEquivalent qty={Number(kuantitas) || 0} unit={satuan} itemCode={kodeBarang} />
          </div>
          <div className="space-y-1.5">
            <Label>Serial No.</Label>
            <Input value={noSeri} onChange={(e) => setNoSeri(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Requester</Label>
            <Input value={peminta} onChange={(e) => setPeminta(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Delivery Order Date</Label>
            <Input type="date" value={tglNpbg} onChange={(e) => setTglNpbg(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Remarks</Label>
            <Input value={keterangan} onChange={(e) => setKeterangan(e.target.value)} />
          </div>
        </div>

        {hasPermission('used_return.update') && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border bg-muted/30 px-3 py-2.5">
            <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={kembaliBekas} onChange={(e) => setKembaliBekas(e.target.checked)} />
            <span className="text-sm">
              <span className="font-medium">Used item returned</span>
              <span className="block text-xs text-muted-foreground">
                Tick if the used item must be returned to the warehouse; this Delivery Order goes into Used Item Return Tracking (Other Spare Parts) until its return RI is recorded.
              </span>
            </span>
          </label>
        )}

        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}
