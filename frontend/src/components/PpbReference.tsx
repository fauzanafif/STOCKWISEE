import { Link } from 'react-router-dom'
import { ClipboardList, ShieldCheck, FileText } from 'lucide-react'
import type { Ppb } from '@/features/ppb/api'
import { cn } from '@/lib/utils'

type Ref = NonNullable<Ppb['document_items']>[number]['reference']

const KIND = {
  REQUEST: { icon: ClipboardList, cls: 'bg-blue-50 text-blue-700 ring-blue-200 hover:bg-blue-100' },
  SAFETY_STOCK: { icon: ShieldCheck, cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100' },
  DRAFT: { icon: FileText, cls: 'bg-slate-100 text-slate-700 ring-slate-200 hover:bg-slate-200' },
} as const

/** Where a PPB line came from — a Request Barang or Safety Stock — as a chip that opens it. */
export function PpbReference({ r }: { r?: Ref }) {
  if (!r) return <span className="text-xs text-muted-foreground" title="Purchase Request from Accurate / made manually">Manual</span>
  const k = KIND[r.type] ?? KIND.DRAFT
  return (
    <Link to={r.to} title={r.hint ?? undefined} onClick={(e) => e.stopPropagation()}
      className={cn('inline-flex max-w-[12rem] items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors', k.cls)}>
      <k.icon className="size-3 shrink-0" /><span className="truncate">{r.label}</span>
    </Link>
  )
}
