import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useDashboard } from '@/features/dashboard/api'
import { InventoryDashboard } from '@/components/dashboard/InventoryDashboard'
import { TrackingDashboard } from '@/components/dashboard/OperationsDashboard'
import { ProcurementDashboard } from '@/components/dashboard/ProcurementDashboard'
import { StockCardReport } from '@/components/dashboard/StockCardReport'
import { exportElementToPdf } from '@/lib/exportDashboardPdf'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The sections of the analytics page, in reading order (ids keep the old ?tab= links working). */
const SECTIONS = [
  { id: 'stok', label: 'Stock Condition' },
  { id: 'pengadaan', label: 'Procurement' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'kartu-stock', label: 'Stock Card' },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

/** One part of the page: a plain heading, then its content. */
function Section({ id, title, children }: { id: SectionId; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-[calc(var(--sw-header)+3.75rem)] space-y-3">
      <h2 id={`${id}-title`} className="flex items-center gap-3 text-base font-semibold">
        {title}<span className="h-px flex-1 bg-border" aria-hidden />
      </h2>
      {children}
    </section>
  )
}

/**
 * Every analysis on its own page, apart from the To-Do board: stock, procurement, tracking and the stock card,
 * with a sticky bar to jump between them.
 */
export function AnalyticsPage() {
  const { user, hasPermission } = useAuth()
  const { data } = useDashboard()
  const exportRootRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const [params] = useSearchParams()
  const [active, setActive] = useState<SectionId>('stok')

  const showStockCard = hasPermission('item.view') || hasPermission('inventory.view')
  const sections = SECTIONS.filter((s) => s.id !== 'kartu-stock' || showStockCard)

  // an old ?tab= link lands on its section
  useEffect(() => {
    const id = params.get('tab')
    if (id && SECTIONS.some((s) => s.id === id)) setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 300)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // the bar marks the section being read
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (seen) setActive(seen.target.id as SectionId)
    }, { rootMargin: '-120px 0px -60% 0px' })
    for (const s of SECTIONS) { const el = document.getElementById(s.id); if (el) io.observe(el) }
    return () => io.disconnect()
  }, [showStockCard])

  if (!user) return null

  const jump = (id: SectionId) => { setActive(id); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }) }

  async function handleExportPdf() {
    if (!exportRootRef.current || exporting) return
    setExporting(true)
    try {
      await exportElementToPdf(exportRootRef.current, {
        title: 'STOCKWISE Analytics',
        subtitle: 'PT Surya Inti Gas',
        filename: `Analytics-STOCKWISE-${new Date().toISOString().slice(0, 10)}.pdf`,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Stock, procurement, tracking and the stock card in one place</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button size="sm" variant="outline" onClick={handleExportPdf} disabled={exporting}>
            {exporting && <Loader2 className="size-4 animate-spin" />}{exporting ? 'Creating PDF…' : 'Download PDF'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>Print</Button>
        </div>
      </div>

      <nav aria-label="Analytics sections"
        className="sticky top-[var(--sw-header)] z-20 -mx-3 flex gap-1 overflow-x-auto border-b bg-background/95 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4 print:hidden">
        {sections.map((s) => (
          <button key={s.id} type="button" onClick={() => jump(s.id)} aria-current={active === s.id ? 'true' : undefined}
            className={cn('shrink-0 rounded-full px-3 py-1 text-[13px] transition-colors max-md:py-1.5',
              active === s.id ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
            {s.label}
          </button>
        ))}
      </nav>

      <div ref={exportRootRef} className="space-y-10 pb-6">
        <Section id="stok" title="Stock Condition"><InventoryDashboard /></Section>
        <Section id="pengadaan" title="Procurement"><ProcurementDashboard poStatus={data?.charts.po_status} /></Section>
        <Section id="tracking" title="Tracking"><TrackingDashboard /></Section>
        {showStockCard && <Section id="kartu-stock" title="Stock Card"><StockCardReport /></Section>}
      </div>
    </div>
  )
}
