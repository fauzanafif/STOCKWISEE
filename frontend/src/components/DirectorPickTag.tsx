import { BadgeCheck, TriangleAlert } from 'lucide-react'
import type { PoLine } from '@/features/purchasing/api'

const rupiah = (n: number) => 'Rp ' + Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 })

/** A PO line against the Direktur's vendor pick: green when it follows it, amber with the pick when it does not. */
export function DirectorPickTag({ pick }: { pick?: PoLine['director_pick'] }) {
  if (!pick) return null
  if (pick.status === 'PILIHAN') {
    return <div className="mt-1"><span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><BadgeCheck className="size-3" />Director Pick</span></div>
  }
  return (
    <div className="mt-1">
      <span className="inline-flex items-center gap-1 rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-amber-950"><TriangleAlert className="size-3" />Not Director Pick</span>
      {pick.vendor && <div className="mt-0.5 text-xs text-amber-900 dark:text-amber-200">Director pick: {pick.vendor}{pick.unit_price != null ? ` · ${rupiah(pick.unit_price)}` : ''}</div>}
    </div>
  )
}
