import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Link2, Loader2, PackagePlus, X } from 'lucide-react'
import { DocSection } from '@/components/doc/DocLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { confirmDialog } from '@/components/ui/confirm'

export interface GateInfo {
  requests: { id: number; number: string; status: string }[]
  receipts: { no_ri: string; id: number; lines: { code: string | null; description: string | null; qty: number; unit: string | null }[] }[]
  posts_stock: boolean
}

/**
 * The warehouse is the only door: what a Manufacturing / Disassembly Order takes out is asked with an Item Request
 * (→ Delivery Order handover), what it puts in comes with a Receipt. This panel shows both and lets the user ask /
 * link them; the order itself never moves stock.
 */
export function WarehouseGatePanel({ gate, outLabel, inLabel, canRequest, canLink, requesting, onRequest, onLink, onUnlink, linking }: {
  gate: GateInfo; outLabel: string; inLabel: string; canRequest: boolean; canLink: boolean; requesting: boolean; linking: boolean
  onRequest: () => void; onLink: (noRi: string, done: () => void) => void; onUnlink: (noRi: string) => void
}) {
  const [noRi, setNoRi] = useState('')
  if (gate.posts_stock) return null
  return (
    <DocSection title="Warehouse documents">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">{outLabel} — Item Request → Delivery Order</div>
            {canRequest && <Button size="sm" variant="outline" disabled={requesting} onClick={onRequest}>{requesting ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />} Request from warehouse</Button>}
          </div>
          {gate.requests.length === 0 ? <p className="text-sm text-muted-foreground">No Item Request yet.</p> : (
            <ul className="space-y-1">{gate.requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <Link to={`/item-requests/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link>
                <Badge variant={r.status === 'SELESAI' ? 'success' : ['DITOLAK', 'DIBATALKAN'].includes(r.status) ? 'neutral' : 'warning'}>{r.status.replaceAll('_', ' ').toLowerCase()}</Badge>
              </li>
            ))}</ul>
          )}
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">{inLabel} — Receipt</div>
          {gate.receipts.length === 0 ? <p className="text-sm text-muted-foreground">No Receipt linked yet.</p> : (
            <ul className="space-y-1">{gate.receipts.map((r) => (
              <li key={r.no_ri} className="flex items-start justify-between gap-2 text-sm">
                <div className="min-w-0"><Link to={`/ri/${r.id}`} className="font-medium text-primary hover:underline">{r.no_ri}</Link>
                  <div className="text-xs text-muted-foreground">{r.lines.map((l) => `${l.code ?? l.description} ${l.qty} ${l.unit ?? ''}`).join(', ')}</div></div>
                {canLink && <Button size="sm" variant="ghost" aria-label={`Unlink ${r.no_ri}`} onClick={async () => {
                  if (await confirmDialog({ message: `Unlink Receipt ${r.no_ri}? The Receipt itself stays.`, danger: true })) onUnlink(r.no_ri)
                }}><X className="size-4" /></Button>}
              </li>
            ))}</ul>
          )}
          {canLink && (
            <div className="flex gap-2">
              <Input value={noRi} maxLength={60} placeholder="Receipt No., e.g. RI/MANUAL/26/XI/001" onChange={(e) => setNoRi(e.target.value)} />
              <Button size="sm" variant="outline" disabled={!noRi.trim() || linking} onClick={() => onLink(noRi.trim(), () => setNoRi(''))}><Link2 className="size-4" /> Link</Button>
            </div>
          )}
        </div>
      </div>
    </DocSection>
  )
}
