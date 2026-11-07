import { useEffect, useRef, useState } from 'react'
import { FileDown, Printer, SlidersHorizontal } from 'lucide-react'
import { api, apiErrorMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'

interface Calibration {
  x: number
  y: number
  pageSize: PageSize
  mode: PrintMode
}

/** a4: A4 portrait, the document scaled to the sheet width; exact: the document's own sheet (A5 / A4); auto: the printer's paper */
type PageSize = 'a4' | 'exact' | 'auto'
/** full: plain paper, kop / labels / lines printed too; data: pre-printed paper, only the data */
type PrintMode = 'full' | 'data'

function calibrationKey(docType: string) {
  return `stockwise:print-calibration:${docType}`
}

/*
 * Paper size is kept under its own key. Default 'exact' = the document's own
 * sheet, which the server now asks for by NAME ("A5 landscape" for NPBG/PPB/RI,
 * "A4" for PO — see DocumentPrintRenderer::cssPageSize), so the browser picks
 * the printer's own A5/A4 form like Accurate does. The former custom
 * "210mm 147mm" (1mm off A5) crashed the HP LaserJet P1102 driver, taking the
 * whole browser down on Print. 'auto' = no size at all (printer's current paper).
 */
function pageSizeKey(docType: string) {
  return `stockwise:print-page-size:v3:${docType}`
}
function modeKey(docType: string) {
  return `stockwise:print-mode:${docType}`
}

const DEFAULT_CALIBRATION: Calibration = { x: 0, y: 0, pageSize: 'a4', mode: 'full' }

function readCalibration(docType: string): Calibration {
  try {
    const raw = localStorage.getItem(calibrationKey(docType))
    const offsets = raw ? (JSON.parse(raw) as Partial<Calibration>) : {}
    const size = localStorage.getItem(pageSizeKey(docType))
    const pageSize: PageSize = size === 'exact' || size === 'auto' ? size : 'a4'
    const mode: PrintMode = localStorage.getItem(modeKey(docType)) === 'data' ? 'data' : 'full'
    return { x: Number(offsets.x) || 0, y: Number(offsets.y) || 0, pageSize, mode }
  } catch {
    return DEFAULT_CALIBRATION
  }
}

/**
 * Cetak untuk SATU dokumen (NPBG/PPB/PO/RI), beda dari ExportBar's "Cetak"
 * yang mencetak seluruh daftar sebagai tabel biasa. Dokumennya ditampilkan di
 * dalam modal pada HALAMAN YANG SAMA lewat <iframe srcDoc>, TIDAK pernah lewat
 * window.open/tab/window baru — tiga pendekatan berbeda yang semua melibatkan
 * tab/window baru (document.write ke popup, Blob URL + print dari opener, Blob
 * URL + inline auto-print script) sudah dicoba dan semuanya membuat Chrome
 * langsung force-close di printer ini. Cetak dari dalam iframe (lewat
 * iframe.contentWindow.print(), dipicu klik tombol — bukan otomatis) tetap di
 * satu tab yang sama, jadi tidak ada window/tab yang dibuka-tutup sama sekali.
 *
 * Elemen statis (logo/kop/label/garis) hilang sendiri lewat CSS `@media print`
 * begitu benar-benar dicetak (lihat App\Services\Export\DocumentPrintRenderer)
 * — yang tercetak ke kertas pre-printed hanya datanya, di posisi yang sama
 * dengan yang terlihat lengkap di modal ini.
 *
 * `autoOpen` + `hideTrigger` + `onClosePreview`: dipakai layar sukses
 * "Tambah ..." (lihat NpbgFormModal dkk.). Layar sukses itu sendiri sebuah
 * Modal; tombol cetak di dalamnya TIDAK boleh menutup modal induknya sambil
 * membuka preview — preview ini anak dari modal itu, jadi ikut hilang seketika
 * (bug "preview cetak menutup sendiri"). Form-nya mengganti layar sukses
 * dengan komponen ini (autoOpen, tanpa tombol) — tetap satu Modal saja, dan
 * menutup preview menutup form-nya lewat `onClosePreview`.
 */
export function PrintDocButton({ url, docType, autoOpen = false, hideTrigger = false, onClosePreview }: {
  url: string
  docType: string
  autoOpen?: boolean
  hideTrigger?: boolean
  onClosePreview?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [html, setHtml] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showCalibration, setShowCalibration] = useState(false)
  const [calibration, setCalibration] = useState<Calibration>(() => readCalibration(docType))
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const autoOpened = useRef(false)

  useEffect(() => {
    setCalibration(readCalibration(docType))
  }, [docType])

  useEffect(() => {
    if (!autoOpen || autoOpened.current) return
    autoOpened.current = true
    void loadAndOpen()
  }, [autoOpen])

  function closePreview() {
    setOpen(false)
    setErr(null)
    onClosePreview?.()
  }

  function saveCalibration(next: Calibration) {
    setCalibration(next)
    try {
      localStorage.setItem(calibrationKey(docType), JSON.stringify({ x: next.x, y: next.y }))
      localStorage.setItem(pageSizeKey(docType), next.pageSize)
      localStorage.setItem(modeKey(docType), next.mode)
    } catch {
      /* ignore storage errors */
    }
  }

  async function loadAndOpen() {
    setBusy(true)
    setErr(null)
    try {
      const res = await api.get(url, {
        params: { offset_x: calibration.x, offset_y: calibration.y, page_size: calibration.pageSize, mode: calibration.mode },
        responseType: 'text',
      })
      setHtml(res.data as string)
      setOpen(true)
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function doPrint() {
    iframeRef.current?.contentWindow?.print()
  }

  /*
   * "Unduh PDF": the same document as a real PDF (data only), printed from a
   * desktop PDF reader (Adobe Reader / SumatraPDF) the way Accurate prints —
   * through Windows, not the browser. Some printer drivers (HP LaserJet P1102,
   * host-based) crash Chrome AND Firefox on Print; this path never touches the
   * browser's print engine. Downloaded as a file (no new tab/window).
   */
  const [pdfBusy, setPdfBusy] = useState(false)
  async function downloadPdf() {
    setPdfBusy(true)
    setErr(null)
    try {
      const res = await api.get(url.replace(/\/print$/, '/print-pdf'), {
        params: { offset_x: calibration.x, offset_y: calibration.y, page_size: calibration.pageSize, mode: calibration.mode },
        responseType: 'blob',
      })
      const name = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ?? `${docType}.pdf`
      const href = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = href
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 10_000)
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setPdfBusy(false)
    }
  }

  const previewNote = calibration.mode === 'data'
    ? 'Data saja: label, kop & garis hanya pratinjau (kertas pre-printed).'
    : 'Lengkap: kop, judul, label, garis & tanda tangan ikut tercetak.'

  const previewFooter = (
    <>
      <span
        className="mr-auto hidden max-w-xs text-xs leading-snug text-muted-foreground md:block"
        title="Download the PDF, open it with Adobe Reader / SumatraPDF and print at actual size (100%); through Windows like Accurate, without the browser print engine."
      >
        Browser closed while printing? Use <b>Download PDF</b> &amp; print from Adobe Reader.
      </span>
      <Button variant="outline" size="sm" onClick={closePreview}>Close</Button>
      <Button variant="outline" size="sm" disabled={pdfBusy} onClick={downloadPdf}>
        <FileDown className="size-4" /> {pdfBusy ? 'Preparing…' : 'Download PDF'}
      </Button>
      <Button size="sm" onClick={doPrint}><Printer className="size-4" /> Print</Button>
    </>
  )

  if (hideTrigger) {
    // opened straight from a "Tambah ..." success screen: just the preview (or its loading / error state)
    return (
      <Modal
        open
        onClose={closePreview}
        title="Print Document"
        description={open ? previewNote : undefined}
        className={open ? 'max-w-4xl' : 'max-w-md'}
        footer={open ? previewFooter : (
          <>
            <Button variant="outline" size="sm" onClick={closePreview}>Close</Button>
            {err && <Button size="sm" disabled={busy} onClick={loadAndOpen}>Try again</Button>}
          </>
        )}
      >
        {open
          ? <>
              {err && <p className="mb-2 text-sm text-destructive">{err}</p>}
              <iframe ref={iframeRef} srcDoc={html ?? ''} title="Printed document" className="h-[70vh] w-full rounded border bg-white" />
            </>
          : <p className={err ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{err ?? 'Preparing document…'}</p>}
      </Modal>
    )
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={loadAndOpen}>
          <Printer className="size-4" /> {busy ? 'Preparing…' : 'Print'}
        </Button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          title="Print position calibration"
          aria-label="Print position calibration"
          onClick={() => setShowCalibration((v) => !v)}
        >
          <SlidersHorizontal className="size-4" />
        </button>
      </div>
      {showCalibration && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-2 text-xs">
          <label className="space-y-1">
            <span className="text-muted-foreground">Shift X (mm)</span>
            <Input
              type="number"
              step="0.5"
              className="h-7 w-20"
              value={calibration.x}
              onChange={(e) => saveCalibration({ ...calibration, x: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">Shift Y (mm)</span>
            <Input
              type="number"
              step="0.5"
              className="h-7 w-20"
              value={calibration.y}
              onChange={(e) => saveCalibration({ ...calibration, y: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">Print content</span>
            <Select
              className="h-7 w-48"
              value={calibration.mode}
              onChange={(e) => saveCalibration({ ...calibration, mode: e.target.value as PrintMode })}
            >
              <option value="full">Complete (plain paper)</option>
              <option value="data">Data only (pre-printed paper)</option>
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground">Paper size</span>
            <Select
              className="h-7 w-44"
              value={calibration.pageSize}
              onChange={(e) => saveCalibration({ ...calibration, pageSize: e.target.value as PageSize })}
            >
              <option value="a4">A4 portrait (actual size)</option>
              <option value="exact">Document size (A5 / A4)</option>
              <option value="auto">Follow printer paper</option>
            </Select>
          </label>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => saveCalibration(DEFAULT_CALIBRATION)}>
            Reset
          </Button>
        </div>
      )}
      {err && <p className="text-xs text-destructive">{err}</p>}

      {open && (
        <Modal
          open
          onClose={closePreview}
          title="Print Document"
          description={previewNote}
          className="max-w-4xl"
          footer={previewFooter}
        >
          {err && <p className="mb-2 text-sm text-destructive">{err}</p>}
          <iframe
            ref={iframeRef}
            srcDoc={html ?? ''}
            title="Printed document"
            className="h-[70vh] w-full rounded border bg-white"
          />
        </Modal>
      )}
    </div>
  )
}
