import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface ItemSerial {
  serial: string
  status: 'IN_STOCK' | 'HELD' | 'OUT'
  source: 'ACCURATE' | 'RI'
  expired: string | null
  in_doc: string | null
  in_date: string | null
  out_doc: string | null
  out_date: string | null
  out_to: string | null
  request: { id: number; number: string; requester: string | null } | null
}
interface SerialsMeta { manage_sn: boolean; code: string; description: string; in_stock: number; held: number; out: number }

export function useItemSerials(itemId: number | null) {
  return useQuery({
    enabled: itemId != null,
    queryKey: ['item-serials', itemId],
    queryFn: async () => (await api.get<{ data: ItemSerial[]; meta: SerialsMeta }>(`/api/items/${itemId}/serials`)).data,
    staleTime: 15_000,
  })
}

const STATUS: Record<ItemSerial['status'], { label: string; tone: string }> = {
  IN_STOCK: { label: 'In stock', tone: 'bg-emerald-50 text-emerald-700' },
  HELD: { label: 'Held', tone: 'bg-violet-50 text-violet-700' },
  OUT: { label: 'Out', tone: 'bg-slate-100 text-slate-600' },
}
const day = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB') : null)

/** Every serial number of an item: in stock, held by an Item Request (picked while verifying), or out. */
export function ItemSerialsModal({ item, onClose }: { item: { id: number; code: string; description: string } | null; onClose: () => void }) {
  const { data, isLoading } = useItemSerials(item?.id ?? null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'' | ItemSerial['status']>('')
  const rows = (data?.data ?? []).filter((r) => (!status || r.status === status) && r.serial.toLowerCase().includes(q.trim().toLowerCase()))
  const m = data?.meta

  return (
    <Modal open={!!item} onClose={() => { setQ(''); setStatus(''); onClose() }} className="max-w-3xl"
      title={<span>Serial numbers <span className="font-normal text-muted-foreground">· {item?.code}</span></span>}
      description={item?.description}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {([['', 'All', (m?.in_stock ?? 0) + (m?.held ?? 0) + (m?.out ?? 0)], ['IN_STOCK', 'In stock', m?.in_stock ?? 0], ['HELD', 'Held', m?.held ?? 0], ['OUT', 'Out', m?.out ?? 0]] as const).map(([k, label, n]) => (
            <button key={k} type="button" onClick={() => setStatus(k)} aria-pressed={status === k}
              className={cn('rounded-full border px-3 py-1 text-[13px]', status === k ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted')}>
              {label} <span className="tabular-nums">{n}</span>
            </button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search serial number" aria-label="Search serial number" className="h-9" />
        <div className="max-h-[60vh] overflow-auto rounded-md border">
          {isLoading ? (
            <div className="flex h-24 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{(data?.data.length ?? 0) ? 'No match.' : 'No serial number recorded for this item yet.'}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2 font-medium">Serial number</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">In</th><th className="px-3 py-2 font-medium">Where now</th></tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.serial} className="align-top">
                    <td className="px-3 py-2 font-mono text-[13px]">{r.serial}{r.expired && <div className="font-sans text-xs text-muted-foreground">exp {day(r.expired)}</div>}</td>
                    <td className="px-3 py-2"><span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STATUS[r.status].tone)}>{STATUS[r.status].label}</span></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.in_doc ? <>{r.in_doc}{r.in_date && <div>{day(r.in_date)}</div>}</> : r.source === 'ACCURATE' ? 'Accurate' : 'Receipt'}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.status === 'HELD' && r.request ? <>For <Link to={`/item-requests/${r.request.id}`} className="font-medium text-primary hover:underline" onClick={onClose}>{r.request.number}</Link>{r.request.requester && <div className="text-muted-foreground">{r.request.requester}</div>}</>
                        : r.status === 'OUT' ? (r.out_doc ? <>{r.out_doc}{r.out_to && <div className="text-muted-foreground">{r.out_to}</div>}{r.out_date && <div className="text-muted-foreground">{day(r.out_date)}</div>}</> : <span className="text-muted-foreground">Out in Accurate</span>)
                          : <span className="text-muted-foreground">Warehouse</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  )
}
