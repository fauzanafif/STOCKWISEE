import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Loader2, Share2, UserRoundCheck, Users, X } from 'lucide-react'
import type { ProxyPerson, RequestProxy } from '@/features/itemRequests/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/notify'
import { confirmDialog } from '@/components/ui/confirm'

const until = (v: string) => new Date(v).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * The requester's "Diwakilkan": who picks the goods up for them, and the one-time QR + 6-digit code to give
 * that person. Gudang scans it at the serah terima. A new name makes a new code (the old one is void).
 */
export function ProxyPickup({ number, proxy, busy, onCreate, onCancel, searchPeople }: {
  number: string
  proxy?: RequestProxy | null
  busy?: boolean
  onCreate: (name: string) => Promise<unknown>
  onCancel: () => Promise<unknown>
  /** the representative is picked from data pekerja */
  searchPeople: (q: string) => Promise<ProxyPerson[]>
}) {
  const [asking, setAsking] = useState(false)
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    if (!proxy?.qr) { setQr(null); return }
    let alive = true
    QRCode.toDataURL(proxy.qr, { width: 360, margin: 1, errorCorrectionLevel: 'M' }).then((url) => alive && setQr(url)).catch(() => alive && setQr(null))
    return () => { alive = false }
  }, [proxy?.qr])

  const save = async () => {
    setErr(null)
    if (!name.trim()) return setErr('Select the representative name from Employee Data.')
    try { await onCreate(name.trim()); setAsking(false); setName('') } catch (e) { setErr((e as { message?: string }).message ?? 'Failed to create the code.') }
  }
  const text = proxy?.code ? `Pick up requested items ${number} at STOCKWISE warehouse under the name ${proxy.name}. Show this QR or give the code ${proxy.code} to the warehouse admin.` : ''
  const share = async () => {
    try {
      if (qr && navigator.canShare) {
        const file = new File([await (await fetch(qr)).blob()], `wakil-${number}.png`, { type: 'image/png' })
        if (navigator.canShare({ files: [file] })) return void (await navigator.share({ title: 'Representative code', text, files: [file] }))
      }
      if (navigator.share) return void (await navigator.share({ title: 'Representative code', text }))
      await navigator.clipboard.writeText(text)
      toast.success('Message & code copied; paste into WhatsApp.')
    } catch { /* closed the share sheet */ }
  }

  if (proxy?.code) {
    return (
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 text-sm font-semibold"><UserRoundCheck className="size-4 text-emerald-600" /> Picked up by representative</div>
            <p className="text-sm"><b>{proxy.name}</b> <span className="text-muted-foreground">· valid until {until(proxy.expires_at)}</span></p>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2 rounded-lg border bg-white p-3">
          {qr ? <img src={qr} alt={`Representative QR ${proxy.name}`} className="size-44" /> : <div className="flex size-44 items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>}
          <div className=" text-2xl font-semibold tracking-[0.3em] text-slate-900">{proxy.code}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="flex-1" onClick={share}><Share2 className="size-4" /> Send to representative</Button>
          <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(proxy.code!); toast.success('Code copied.') }}><Copy className="size-4" /> Code</Button>
        </div>
        <div className="flex flex-wrap gap-x-3 text-xs">
          <button type="button" className="text-primary hover:underline" onClick={() => { setName(''); setAsking(true) }}>Change representative</button>
          <button type="button" className="text-muted-foreground hover:text-destructive" disabled={busy}
            onClick={async () => { if (await confirmDialog({ message: `Cancel representative ${proxy.name}? The code will no longer be valid.`, danger: true })) await onCancel() }}>I will collect it myself</button>
        </div>
        {asking && <NameForm name={name} setName={setName} err={err} busy={busy} onSave={save} onClose={() => setAsking(false)} search={searchPeople} />}
      </div>
    )
  }

  return asking ? (
    <NameForm name={name} setName={setName} err={err} busy={busy} onSave={save} onClose={() => setAsking(false)} search={searchPeople} />
  ) : (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">Picked up by someone else?</div>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => setAsking(true)}><Users className="size-4" /> By representative</Button>
    </div>
  )
}

/** The representative's name: typed, then picked from the data pekerja suggestions (only a picked name is saved). */
function NameForm({ name, setName, err, busy, onSave, onClose, search }: {
  name: string; setName: (v: string) => void; err: string | null; busy?: boolean; onSave: () => void; onClose: () => void
  search: (q: string) => Promise<ProxyPerson[]>
}) {
  const [typed, setTyped] = useState(name)
  const [found, setFound] = useState<ProxyPerson[]>([])
  const [loading, setLoading] = useState(false)
  const [hi, setHi] = useState(0)
  const picked = !!name && name === typed
  useEffect(() => {
    const q = typed.trim()
    if (picked || q.length < 2) { setFound([]); return }
    let alive = true
    setLoading(true)
    const t = setTimeout(() => {
      search(q).then((r) => { if (alive) { setFound(r); setHi(0) } }).catch(() => alive && setFound([])).finally(() => alive && setLoading(false))
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [typed, picked])
  const pick = (p: ProxyPerson) => { setName(p.name); setTyped(p.name); setFound([]) }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, found.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (found[hi]) pick(found[hi]); else if (picked) onSave() }
    else if (e.key === 'Escape' && found.length) { e.stopPropagation(); setFound([]) }
  }
  const q = typed.trim()
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <label htmlFor="proxy-name" className="text-sm font-medium">Who is collecting?</label>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-0.5 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
      </div>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Input id="proxy-name" autoFocus autoComplete="off" maxLength={150} value={typed} onKeyDown={onKey}
            onChange={(e) => { setTyped(e.target.value); if (name) setName('') }} placeholder="Type a name, then select"
            role="combobox" aria-expanded={found.length > 0} aria-controls="proxy-people" aria-autocomplete="list" />
          {picked && <UserRoundCheck className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-emerald-600" />}
          {found.length > 0 && (
            <ul id="proxy-people" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-card p-1 shadow-lg">
              {found.map((p, i) => (
                <li key={p.name + i} role="option" aria-selected={i === hi}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)} onMouseEnter={() => setHi(i)}
                    className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-sm ${i === hi ? 'bg-primary/10 text-primary' : ''}`}>
                    <span className="truncate font-medium">{p.name}</span>
                    {p.divisi && <span className="shrink-0 text-xs text-muted-foreground">{p.divisi}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button onClick={onSave} disabled={busy || !picked}>{busy ? <Loader2 className="size-4 animate-spin" /> : 'Create QR'}</Button>
      </div>
      {!picked && q.length >= 2 && !loading && found.length === 0 && <p className="text-xs text-muted-foreground">No name "{q}" in Employee Data.</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  )
}
