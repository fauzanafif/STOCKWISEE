import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronDown, Inbox, Loader2, Search } from 'lucide-react'
import { apiErrorMessage } from '@/lib/api'
import {
  REQUEST_STATUS, fetchMyRequestTokens, forgetTrack, rememberTrack, signedFormSession, trackedTokens, useLookupRequest, usePublicRequestProxy, usePublicRequestStatus,
  type PublicRequestStatus,
} from '@/features/itemRequests/api'
import { RequestTimeline, TimelineBar } from '@/components/itemRequests/RequestTimeline'
import { RequestImages } from '@/components/itemRequests/RequestImages'
import { ProxyPickup } from '@/components/itemRequests/ProxyPickup'
import { PublicShell } from '@/pages/PublicItemRequestPage'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { invalidTo } from '@/lib/notify'

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '-')
const fmtQty = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })

type StatusLine = PublicRequestStatus['lines'][number]
/** the lines under what the requester typed: one requested item may be verified as several Master Produk items */
function groupLines(lines: StatusLine[]) {
  const out: { asked: string; lines: StatusLine[] }[] = []
  for (const l of lines) {
    const asked = l.asked ?? l.deskripsi_barang
    const g = out.find((x) => x.asked === asked)
    if (g) g.lines.push(l)
    else out.push({ asked, lines: [l] })
  }
  return out
}

function StatusProxy({ r }: { r: PublicRequestStatus }) {
  const p = usePublicRequestProxy(r.token)
  return <ProxyPickup number={r.number} proxy={r.proxy} busy={p.create.isPending || p.cancel.isPending}
    onCreate={(name) => p.create.mutateAsync(name)} onCancel={() => p.cancel.mutateAsync()} searchPeople={p.people} />
}

function StatusCard({ r, open, onToggle }: { r: PublicRequestStatus; open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-lg border bg-card">
      <button type="button" onClick={onToggle} aria-expanded={open} className="block w-full space-y-3 p-4 text-left">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className=" font-semibold">{r.number}</div>
            <div className="text-xs text-muted-foreground">{fmtDate(r.created_at)} · {r.lines.length} items</div>
          </div>
          <div className="flex items-center gap-1">
            <Badge variant={r.ready_to_pick ? 'warning' : REQUEST_STATUS[r.status]?.variant ?? 'neutral'}>{r.ready_to_pick ? 'Ready to collect' : r.status_label || REQUEST_STATUS[r.status]?.label}</Badge>
            <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </div>
        </div>
        <TimelineBar steps={r.timeline} />
        {/* what the requester should do / expect now, in plain words */}
        {r.ready_to_pick ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">The items are prepared by the warehouse. Please collect them at the warehouse and sign at handover.</p>
        ) : r.status === 'SELESAI' ? (
          <p className="text-sm font-medium text-emerald-700">All items handed over{r.received_by ? ` (received ${r.received_by})` : ''}.</p>
        ) : ['DIPENUHI_SEBAGIAN', 'MENUNGGU_PENGADAAN', 'MENUNGGU_BARANG', 'DISIAPKAN'].includes(r.status) && r.lines.some((l) => (l.fulfilled_qty ?? 0) > 0) ? (
          <p className="text-sm font-medium text-teal-700">Some items are handed over, the rest in process.</p>
        ) : ['MENUNGGU_PENGADAAN', 'MENUNGGU_BARANG'].includes(r.status) ? (
          <p className="text-sm text-indigo-700">The item is out of stock and being purchased. You will be notified when it arrives.</p>
        ) : r.status === 'PERLU_PERBAIKAN' ? (
          <p className="text-sm text-orange-700">The request is being corrected by the warehouse admin.</p>
        ) : null}
      </button>
      {/* pickup by a representative: the QR to send them (always in sight while it is active) */}
      {(r.can_proxy || r.proxy?.code) && (open || r.proxy?.code || r.ready_to_pick) && <div className="border-t p-4"><StatusProxy r={r} /></div>}
      {open && (
        <div className="space-y-4 border-t p-4">
          <RequestTimeline steps={r.timeline} />
          {r.verify_note && <p className="whitespace-pre-wrap rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-950"><span className="block text-xs text-blue-700">Warehouse admin notes</span>{r.verify_note}</p>}
          {(r.images?.length ?? 0) > 0 && <div className="space-y-1.5 border-t pt-3"><div className="text-xs font-medium text-muted-foreground">Image</div><RequestImages slots={r.images} token={r.token} /></div>}
          <ul className="space-y-3 border-t pt-3 text-sm">
            {groupLines(r.lines).map((g) => (
              <li key={g.lines[0].id} className="space-y-1">
                <div className="flex justify-between gap-3">
                  <span className={cn('min-w-0 break-words font-medium', g.lines.every((l) => l.decision === 'TOLAK') && 'text-muted-foreground line-through')}>{g.asked}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{fmtQty(g.lines.reduce((n, l) => n + Number(l.qty), 0))} {g.lines[0].satuan ?? ''}</span>
                </div>
                {(g.lines[0].images?.length ?? 0) > 0 && <RequestImages slots={g.lines[0].images} token={r.token} lineId={g.lines[0].id} size="size-12" className="gap-1" />}
                {/* the Master Produk items admin gudang verified it as (one requested item may be several) */}
                {g.lines.some((l) => l.item) ? (
                  <ul className="space-y-1 border-l-2 border-primary/20 pl-3">
                    {g.lines.map((l) => (
                      <li key={l.id} className="flex justify-between gap-3">
                        <span className="min-w-0">
                          {l.item ? (
                            <span className="block break-words"><span className="text-[13px] text-muted-foreground">{l.item.code}</span> {l.item.name}</span>
                          ) : <span className="block text-muted-foreground line-through">{l.deskripsi_barang}</span>}
                          <span className="block text-xs text-muted-foreground">{l.line_status_label ?? (r.approved ? 'Approved' : 'Verified, waiting for approval')}</span>
                          {l.short_reason && <span className="block text-xs text-amber-700">Given less: {l.short_reason}</span>}
                        </span>
                        <span className="shrink-0 text-right tabular-nums text-muted-foreground">
                          {l.approved_qty != null && (l.fulfilled_qty ?? 0) > 0 ? `${fmtQty(Number(l.approved_qty))}/${fmtQty(l.fulfilled_qty ?? 0)}` : fmtQty(Number(l.approved_qty ?? l.qty))} {l.satuan ?? ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <>
                    {g.lines[0].line_status_label && <span className="block text-xs text-muted-foreground">{g.lines[0].line_status_label}</span>}
                    {g.lines[0].reject_reason && <span className="block text-xs text-destructive">Rejected: {g.lines[0].reject_reason}</span>}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Cek Permintaan — no login. /cek-permintaan lists the requests sent from this device;
 * /cek-permintaan/:token opens one. Others are found by number + name. Live.
 */
export function RequestStatusPage() {
  const { token } = useParams()
  const [tokens, setTokens] = useState<string[]>(() => trackedTokens())
  useEffect(() => {
    if (token) { rememberTrack(token); setTokens(trackedTokens()) }
  }, [token])
  // signed in to the request form: every request of that account, sent from any device
  const [mineName, setMineName] = useState<string | null>(null)
  useEffect(() => {
    const signed = signedFormSession()
    if (!signed || token) return
    let alive = true
    fetchMyRequestTokens(signed.session).then((d) => {
      if (!alive) return
      ;[...d.tokens].reverse().forEach(rememberTrack)
      setTokens(trackedTokens())
      setMineName(d.name || signed.name)
    }).catch(() => { /* the sign-in ran out: this device's list stays */ })
    return () => { alive = false }
  }, [token])
  const shown = token ? [token] : tokens
  const status = usePublicRequestStatus(shown)
  const [openId, setOpenId] = useState<string | null>(token ?? null)
  const lookup = useLookupRequest()
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)

  // requests that no longer exist drop off this device's list
  useEffect(() => {
    if (!status.data || token) return
    const alive = new Set(status.data.map((r) => r.token))
    const gone = tokens.filter((t) => !alive.has(t))
    if (gone.length) { gone.forEach(forgetTrack); setTokens(trackedTokens()) }
  }, [status.data, token, tokens])

  const find = () => {
    setErr(null)
    if (name.trim().length < 3) return invalidTo(setErr, 'Write your name (at least 3 letters).')
    lookup.mutate(name.trim(), {
      onSuccess: (found) => { setTokens(trackedTokens()); setOpenId(found[0] ?? null); setName('') },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  const rows = status.data ?? []

  return (
    <PublicShell title="Check Request">
      <div className="space-y-3">
        {!token && (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <Input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()}
                placeholder="Type your name" aria-label="Your name" autoComplete="name" />
              <Button onClick={find} disabled={lookup.isPending} aria-label="Search">
                {lookup.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search
              </Button>
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>
        )}
        {status.isLoading && shown.length > 0 && <p className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></p>}
        {!status.isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Inbox className="size-10" />
            <p>{token ? 'Request not found' : 'Find your requests by name'}</p>
          </div>
        )}
        {mineName && rows.length > 0 && <p className="text-sm text-muted-foreground">Requests under the name <b className="text-foreground">{mineName}</b></p>}
        {rows.map((r) => <StatusCard key={r.token} r={r} open={openId === r.token} onToggle={() => setOpenId((o) => (o === r.token ? null : r.token))} />)}

        {token && <p className="text-center text-sm"><Link to="/cek-permintaan" className="text-muted-foreground hover:text-foreground">All my requests</Link></p>}
      </div>
    </PublicShell>
  )
}
