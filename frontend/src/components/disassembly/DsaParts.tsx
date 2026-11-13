import { useState } from 'react'
import { DSA_STATUS, useDsaItems, type DsaItem, type DsaStatus } from '@/features/disassembly/api'
import { fmtQty } from '@/features/mrp/api'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

export function DsaStatusBadge({ status }: { status: DsaStatus }) {
  const s = DSA_STATUS[status]
  return <Badge variant={s.variant}>{s.label}</Badge>
}

/** Products that can be taken apart (active BoM), searched by code or name, with their free stock. */
export function DsaItemPicker({ onPick, placeholder = 'Search a product with an active BoM…' }: { onPick: (item: DsaItem) => void; placeholder?: string }) {
  const [q, setQ] = useState('')
  const { data, isFetching } = useDsaItems(q)
  const open = q.trim().length >= 2
  const rows = data ?? []

  return (
    <div className="relative">
      <Input placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-card shadow-md">
          {isFetching && rows.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>}
          {!isFetching && rows.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No product with an active BoM found.</li>}
          {rows.map((it) => (
            <li key={it.id}>
              <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { onPick(it); setQ('') }}>
                <span className="text-[13px] text-muted-foreground">{it.code}</span> {it.description}
                <span className="ml-2 text-xs text-muted-foreground">{it.unit} · free {fmtQty(it.available, 2)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
