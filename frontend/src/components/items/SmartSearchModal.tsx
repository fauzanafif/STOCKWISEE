import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Loader2, Search, Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ExportBar } from '@/components/export/ExportBar'
import { cn } from '@/lib/utils'

interface Total { unit: string; qty: number }
interface BrandGroup {
  brand: string | null
  items_count: number
  in_stock_count: number
  totals: Total[]
  items: { id: number; code: string; description: string; unit: string; qty: number; condition: string | null; relevance: string | null }[]
}
interface BrandResult { query: string; items_count: number; brands_count: number; totals: Total[]; truncated: boolean; groups: BrandGroup[] }

const fmt = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
const totalsText = (t: Total[]) => (t.length ? t.map((x) => `${fmt(x.qty)} ${x.unit}`).join(' + ') : '0')
const CONDITION: Record<string, { label: string; variant: 'warning' | 'danger' | 'neutral' }> = {
  BEKAS: { label: 'Used', variant: 'warning' }, RUSAK: { label: 'Damaged', variant: 'danger' }, VULKANISIR: { label: 'Retreaded', variant: 'neutral' },
}

/** Waits until typing stops, so every key does not send a search. */
function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * Smart Search by brand: for a specification (e.g. "Ban 7.50 R16"), which brands the warehouse has, how many different
 * items of each brand, and their total stock (the QTY of the Master Barang, summed per unit). Brands are read from the
 * item names only where they are clear; the rest stays in "Brand not clear".
 */
export function SmartSearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [excludeUsed, setExcludeUsed] = useState(false)
  const [excludeDamaged, setExcludeDamaged] = useState(false)
  const [openBrand, setOpenBrand] = useState<string | null>(null)
  const term = useDebounced(q.trim())
  const { data, isFetching, isError } = useQuery({
    queryKey: ['items', 'smart-search', term, excludeUsed, excludeDamaged],
    enabled: open && term.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async () => (await api.get<{ data: BrandResult }>('/api/items/smart-search', { params: { q: term, exclude_used: excludeUsed ? 1 : 0, exclude_damaged: excludeDamaged ? 1 : 0 } })).data.data,
  })
  const res = term.length >= 2 ? data : undefined

  return (
    <Modal open={open} onClose={onClose} title="Smart Search" className="max-w-6xl"
      description="Type a specification or name, e.g. Ban 7.50 R16, 750-16, bearing koyo. Spelling, separators and small typos do not matter.">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus className="pl-9" value={q} maxLength={120} placeholder="Search a specification, name or code…" onChange={(e) => { setQ(e.target.value); setOpenBrand(null) }} />
            {isFetching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          <label className="flex items-center gap-2 text-sm" title="Items named (BEKAS): used, often still usable">
            <input type="checkbox" checked={excludeUsed} onChange={(e) => setExcludeUsed(e.target.checked)} />
            Exclude used (BEKAS)
          </label>
          <label className="flex items-center gap-2 text-sm" title="Items named (RUSAK): damaged">
            <input type="checkbox" checked={excludeDamaged} onChange={(e) => setExcludeDamaged(e.target.checked)} />
            Exclude damaged (RUSAK)
          </label>
          {res && res.items_count > 0 && (
            <ExportBar dataset="item-brands" filters={{ q: term, exclude_used: excludeUsed ? 1 : 0, exclude_damaged: excludeDamaged ? 1 : 0 }} filenameBase="smart-search-brands" viewPermission="item.view" />
          )}
        </div>

        {term.length < 2 && <p className="py-10 text-center text-sm text-muted-foreground"><Sparkles className="mx-auto mb-2 size-5" />Type at least 2 characters.</p>}
        {isError && <p className="text-sm text-destructive">Search failed. Try again.</p>}

        {res && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-card px-3 py-2"><div className="text-xs text-muted-foreground">Brands</div><div className="text-lg font-semibold tabular-nums">{res.brands_count}</div></div>
              <div className="rounded-lg border bg-card px-3 py-2"><div className="text-xs text-muted-foreground">Item types</div><div className="text-lg font-semibold tabular-nums">{res.items_count}</div></div>
              <div className="rounded-lg border bg-card px-3 py-2"><div className="text-xs text-muted-foreground">Total stock</div><div className="text-lg font-semibold tabular-nums">{totalsText(res.totals)}</div></div>
            </div>
            {res.truncated && <p className="text-xs text-amber-700">Showing the 1,000 best matches; type a more specific search.</p>}

            {res.groups.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No item matches “{res.query}”. Try fewer words, another spelling (e.g. 7.50-16 or 750 R16), or the item code.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 text-left text-xs text-slate-600"><tr>
                    <th className="px-3 py-2">Brand</th><th className="px-3 py-2 text-right">Item types</th><th className="px-3 py-2 text-right">In stock</th><th className="px-3 py-2 text-right">Total stock</th>
                  </tr></thead>
                  <tbody>
                    {res.groups.map((g) => {
                      const key = g.brand ?? '—'
                      const expanded = openBrand === key
                      return [
                        <tr key={key} className={cn('cursor-pointer border-t hover:bg-muted/40', expanded && 'bg-muted/30')} onClick={() => setOpenBrand(expanded ? null : key)}>
                          <td className="px-3 py-2 font-medium">
                            <span className="inline-flex items-center gap-1">{expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                              {g.brand ?? <span className="font-normal italic text-muted-foreground">Brand not clear from the name</span>}</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{g.items_count}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{g.in_stock_count}</td>
                          <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', g.totals.every((t) => t.qty === 0) && 'text-muted-foreground')}>{totalsText(g.totals)}</td>
                        </tr>,
                        expanded && (
                          <tr key={`${key}-items`} className="border-t bg-muted/10">
                            <td colSpan={4} className="px-3 py-2">
                              <ul className="divide-y">
                                {g.items.map((it) => (
                                  <li key={it.id} className="flex items-start justify-between gap-3 py-1.5">
                                    <div className="min-w-0">
                                      <div className="text-[13px]">{it.description}</div>
                                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                        {it.code}
                                        {it.condition && <Badge variant={CONDITION[it.condition]?.variant ?? 'neutral'}>{CONDITION[it.condition]?.label ?? it.condition}</Badge>}
                                        {it.relevance && <span className="rounded bg-slate-100 px-1 text-[10px]">{it.relevance}</span>}
                                      </div>
                                    </div>
                                    <div className={cn('shrink-0 tabular-nums', it.qty > 0 ? 'font-medium' : 'text-muted-foreground')}>{fmt(it.qty)} {it.unit}</div>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        ),
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Stock = the QTY of the Master Barang (all warehouses), summed per unit. Brands are read from the item names (NAME - BRAND / …) only where they are clear.</p>
          </>
        )}
      </div>
    </Modal>
  )
}
