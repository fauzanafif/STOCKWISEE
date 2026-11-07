import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { uomPreview } from '@/features/uom/api'
import { cn } from '@/lib/utils'

const fmt = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })

/** What a quantity written in a unit makes in the item's Base UOM: "= 200 MTR", or why it cannot be counted yet. */
export function UomEquivalent({ qty, unit, itemId, itemCode, className }: { qty: number; unit: string | null | undefined; itemId?: number | null; itemCode?: string | null; className?: string }) {
  // typing waits a moment before it asks the server
  const wanted = JSON.stringify([qty, unit ?? '', itemId ?? null, itemCode ?? ''])
  const [asked, setAsked] = useState(wanted)
  useEffect(() => { const t = setTimeout(() => setAsked(wanted), 300); return () => clearTimeout(t) }, [wanted])
  const [q, u, id, code] = JSON.parse(asked) as [number, string, number | null, string]
  const { data } = useQuery({
    queryKey: ['uom', 'preview', asked],
    enabled: q > 0 && !!u.trim() && (id != null || !!code.trim()),
    staleTime: 60_000,
    retry: false,
    queryFn: () => uomPreview({ qty: q, unit: u, item_id: id ?? undefined, item_code: code.trim() || undefined }),
  })
  if (!data || !(qty > 0)) return null
  if (data.problem) return <span className={cn('block text-xs text-red-600', className)}>{data.problem}</span>
  if (!data.known && u.trim()) return <span className={cn('block text-xs text-amber-700', className)}>{u.trim().toUpperCase()} is not in the UOM master: counted as written</span>
  if (!data.converts) return null
  return <span className={cn('block text-xs font-medium tabular-nums text-primary', className)}>= {fmt(data.base_qty)} {data.base_unit}</span>
}

/** A saved line in another unit: what it makes in the Base UOM. */
export function InBaseUom({ qty, ratio, base, className }: { qty: number | string | null | undefined; ratio: number | null | undefined; base: string | null | undefined; className?: string }) {
  if (!base || !ratio || ratio === 1 || qty == null) return null
  return <span className={cn('block text-xs font-normal tabular-nums text-muted-foreground', className)}>= {fmt(Math.round(Number(qty) * ratio * 100) / 100)} {base}</span>
}
