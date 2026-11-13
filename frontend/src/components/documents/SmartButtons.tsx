import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, PackageCheck, PackageOpen, ShoppingCart, Truck, Undo2, ClipboardList, ClipboardPen, type LucideIcon } from 'lucide-react'
import { DOC_PATH, useRelated, type DocType, type RelatedGroup } from '@/features/documents/api'
import { Modal } from '@/components/ui/modal'
import { cn } from '@/lib/utils'

const ICON: Record<DocType, LucideIcon> = {
  item_request: ClipboardList, delivery_order: Truck, ppb_draft: ClipboardPen, purchase_request: PackageOpen,
  purchase_order: ShoppingCart, receipt: PackageCheck, purchase_return: Undo2,
}

const fmtDay = (v: string | null) => (v ? new Date(v + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

/**
 * Odoo-style Smart Buttons: one button per kind of related document with its real count; a single document opens
 * directly, several open a short list. Only kinds the user may open are returned by the server.
 */
export function SmartButtons({ type, id, className }: { type: DocType; id: number; className?: string }) {
  const { data } = useRelated(type, id)
  const [open, setOpen] = useState<RelatedGroup | null>(null)
  const groups = data?.groups ?? []
  if (groups.length === 0) return null

  return (
    <>
      <div className={cn('flex flex-wrap gap-2', className)} aria-label="Related documents">
        {groups.map((g) => {
          const Icon = ICON[g.type] ?? FileText
          const body = (
            <>
              <Icon className="size-4 shrink-0 text-primary" />
              <span className="flex flex-col items-start leading-tight">
                <span className="text-sm font-semibold tabular-nums">{g.count}</span>
                <span className="text-xs text-muted-foreground">{g.label}</span>
              </span>
            </>
          )
          const cls = 'flex min-w-[8.5rem] items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-left shadow-[0_1px_2px_rgb(15_23_42/0.05)] transition-colors hover:bg-muted/50'
          return g.count === 1
            ? <Link key={g.type} to={DOC_PATH[g.type](g.docs[0].id)} className={cls} title={`Open ${g.docs[0].number}`}>{body}</Link>
            : <button key={g.type} type="button" className={cls} onClick={() => setOpen(g)}>{body}</button>
        })}
      </div>
      {open && (
        <Modal open onClose={() => setOpen(null)} title={`${open.label} · ${data?.document.number ?? ''}`}>
          <ul className="divide-y rounded-md border">
            {open.docs.map((d) => (
              <li key={`${d.type}-${d.id}`}>
                <Link to={DOC_PATH[d.type](d.id)} onClick={() => setOpen(null)} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-muted/50">
                  <span className="min-w-0"><span className="font-medium text-primary">{d.number}</span>{d.party && <span className="ml-2 text-xs text-muted-foreground">{d.party}</span>}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{[d.status?.replaceAll('_', ' ').toLowerCase(), fmtDay(d.date)].filter(Boolean).join(' · ')}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  )
}
