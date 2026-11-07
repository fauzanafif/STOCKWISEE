import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  // a status is a soft pill: the same five meanings everywhere
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:opacity-70 before:content-['']",
  {
    variants: {
      variant: {
        default: 'bg-blue-50 text-blue-700',
        neutral: 'bg-slate-100 text-slate-600',
        success: 'bg-emerald-50 text-emerald-700',
        warning: 'bg-amber-50 text-amber-800',
        danger: 'bg-red-50 text-red-700',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'success' | 'danger' | 'neutral' }> = {
    AMAN: { label: 'Safe', variant: 'success' },
    TIDAK_AMAN: { label: 'Unsafe', variant: 'danger' },
    BEP: { label: 'Out of Stock', variant: 'neutral' },
  }
  const s = map[status] ?? { label: status, variant: 'neutral' as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

export function PriorityBadge({ level }: { level: string }) {
  const map: Record<string, 'danger' | 'warning' | 'neutral'> = {
    HIGH: 'danger',
    MEDIUM: 'warning',
    LOW: 'neutral',
  }
  return <Badge variant={map[level] ?? 'neutral'}>{level}</Badge>
}
