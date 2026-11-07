import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  /** A create / edit form: at least ~900px wide, the title alone in its header, denser rows. */
  form?: boolean
  /** A transaction with many fields or an item table: takes the whole work area instead of a popup. */
  page?: boolean
}

const WIDTHS = ['max-w-sm', 'max-w-md', 'max-w-lg', 'max-w-xl', 'max-w-2xl', 'max-w-3xl', 'max-w-4xl', 'max-w-5xl', 'max-w-6xl', 'max-w-7xl']

function useDialogKeys(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])
}

export function Modal(props: ModalProps) {
  return props.page ? <PageModal {...props} /> : <PopupModal {...props} />
}

function PageModal({ open, onClose, title, children, footer }: ModalProps) {
  useDialogKeys(open, onClose)
  if (!open) return null
  return createPortal(
    <div role="dialog" aria-modal="true" className="fixed inset-x-0 bottom-0 top-0 z-40 flex flex-col bg-background lg:left-[var(--sw-sidebar,0px)] lg:top-[var(--sw-header,0px)]" data-form-panel="">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-card px-3 py-2 sm:px-4">
        <h2 className="min-w-0 truncate text-base font-semibold">{title}</h2>
        <button onClick={onClose} className="flex size-10 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground lg:size-8" aria-label="Close"><X className="size-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">{children}</div>
      {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-card px-3 py-2 sm:px-4">{footer}</div>}
    </div>,
    document.body,
  )
}

function PopupModal({ open, onClose, title, description, children, footer, className, form }: ModalProps) {
  useDialogKeys(open, onClose)
  if (!open) return null
  const asked = (className ?? '').split(/\s+/).find((c) => WIDTHS.includes(c))
  const width = form && !asked ? 'max-w-3xl' : asked

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/30 sm:items-start sm:p-8">
      <div
        className={cn('w-full rounded-t-lg border bg-card shadow-lg sm:my-auto sm:rounded-lg', width ?? 'max-w-lg', className)}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
            {description && !form && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
          </div>
          <button onClick={onClose} className="flex size-10 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground sm:size-7" aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="max-h-[75dvh] overflow-y-auto overscroll-contain px-4 py-3" data-form-panel={form ? '' : undefined}>{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t px-4 py-2.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
