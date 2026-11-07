import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { pageMeta } from '@/lib/navigation'
import { cn } from '@/lib/utils'

/** The module's icon, the page title, and the page's actions (right). Explanations live in the Guide. */
export function PageHeader({ title, actions }: { title: string; subtitle?: string; icon?: ReactNode; actions?: ReactNode }) {
  const meta = pageMeta(useLocation().pathname)
  const Icon = meta?.icon
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg print:hidden', meta.tone)}><Icon className="size-[18px]" /></span>}
        <h1 className="min-w-0 text-lg font-semibold">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
