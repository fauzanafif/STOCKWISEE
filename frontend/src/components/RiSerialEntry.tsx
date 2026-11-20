import { useRef, useState } from 'react'
import { Download, Loader2, Upload } from 'lucide-react'
import { exportRiSerials } from '@/features/ri/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/lib/notify'
import { apiErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Above this a page of inputs gets slow: such a delivery goes through Excel. */
const MAX_INPUTS = 300

export const filledSerials = (value: string[] | undefined) => (value ?? []).map((s) => s.trim()).filter(Boolean)
export const splitSerials = (text: string | null | undefined) => (text ?? '').split(';').map((s) => s.trim()).filter(Boolean)

/**
 * A problem with the serials of a line, or null: one per unit, no repeats. None at all is fine unless the line
 * is ticked "Has SN" (required): then every unit needs its serial number.
 */
export function serialProblem(value: string[] | undefined, qty: number, required = false): string | null {
  const list = filledSerials(value)
  if (list.length === 0) return required ? `"Has SN" is ticked: fill in ${Number.isInteger(qty) && qty > 0 ? qty : 'the'} serial number${qty === 1 ? '' : 's'}, or untick it` : null
  if (!Number.isInteger(qty)) return 'serial numbers need a whole quantity'
  if (list.length !== qty) return `${qty} units received but ${list.length} serial numbers`
  const seen = new Set<string>()
  for (const s of list) {
    if (seen.has(s.toLowerCase())) return `serial number ${s} is written twice`
    seen.add(s.toLowerCase())
  }
  return null
}

/** One numbered input per unit. Enter moves down (a barcode scanner sends one), a pasted column fills downward. */
export function RiSerialEntry({ qty, value, onChange, label }: { qty: number; value: string[]; onChange: (v: string[]) => void; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const units = Number.isInteger(qty) && qty > 0 ? qty : 0
  const slots = Math.max(units, value.length)
  const counts = new Map<string, number>()
  for (const s of filledSerials(value)) counts.set(s.toLowerCase(), (counts.get(s.toLowerCase()) ?? 0) + 1)
  const set = (i: number, text: string) => { const next = [...value]; next[i] = text; onChange(Array.from(next, (s) => s ?? '')) }
  const focus = (i: number) => box.current?.querySelectorAll('input')[i]?.focus()

  if (slots > MAX_INPUTS) return <p className="text-sm text-muted-foreground">{filledSerials(value).length} of {units} serial numbers. More than {MAX_INPUTS} units: use Export and Import Excel.</p>
  if (slots === 0) return <p className="text-sm text-muted-foreground">Fill in a whole received quantity first.</p>
  return (
    <div ref={box} className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: slots }, (_, i) => {
        const text = value[i] ?? ''
        const twice = (counts.get(text.trim().toLowerCase()) ?? 0) > 1
        return (
          <label key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={cn('w-7 shrink-0 text-right tabular-nums', i >= units && 'text-red-600')}>{i + 1}</span>
            <Input className={cn('h-8 bg-card', twice && 'border-red-400', i >= units && 'border-red-400')} value={text} maxLength={100} aria-label={`${label} serial ${i + 1}`}
              onChange={(e) => set(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focus(i + 1) } }}
              onPaste={(e) => {
                const lines = e.clipboardData.getData('text').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
                if (lines.length < 2) return
                e.preventDefault()
                const next = [...value]
                lines.forEach((s, k) => { next[i + k] = s })
                onChange(Array.from(next, (s) => s ?? ''))
              }} />
          </label>
        )
      })}
    </div>
  )
}

/** Export a sheet with a row per unit, import it back once filled. */
export function RiSerialExcelButtons({ onExport, onImport }: { onExport: () => Promise<void>; onImport: (file: File) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<void>) => { setBusy(true); try { await work() } finally { setBusy(false) } }
  return (
    <div className="flex flex-wrap gap-2">
      <input ref={input} type="file" accept=".xlsx" className="hidden" aria-label="Serial numbers Excel file"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(() => onImport(f)) }} />
      <Button type="button" size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => void run(onExport)}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} Export serial Excel</Button>
      <Button type="button" size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => input.current?.click()}><Upload className="size-3.5" /> Import serial Excel</Button>
    </div>
  )
}

/** The recorded serials of an RI line: one is shown as it is, several open a numbered list. */
export function RiSerialList({ riId, text, item }: { riId: number; text: string | null | undefined; item: string | null }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const list = splitSerials(text)
  if (list.length < 2) return <>{text || null}</>
  return (
    <>
      <button type="button" className="whitespace-nowrap text-primary hover:underline" onClick={() => setOpen(true)}>{list.length} serial numbers</button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Serial numbers" className="max-w-lg" description={`${item ?? ''} · ${list.length} units`}
          footer={<>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Close</Button>
            <Button size="sm" disabled={busy} onClick={() => { setBusy(true); exportRiSerials(riId).catch((e) => toast.fromError(e, apiErrorMessage(e))).finally(() => setBusy(false)) }}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Export Excel</Button>
          </>}>
          <ol className="grid max-h-[55vh] gap-x-4 gap-y-1 overflow-auto text-sm sm:grid-cols-2">
            {list.map((s, i) => <li key={`${s}-${i}`} className="flex gap-2"><span className="w-7 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}</span><span className="min-w-0 break-all">{s}</span></li>)}
          </ol>
        </Modal>
      )}
    </>
  )
}
