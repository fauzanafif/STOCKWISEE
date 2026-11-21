import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { StockCardReport } from '@/components/dashboard/StockCardReport'
import { InventoryAnalytics, PurchaseAnalytics, TrackingAnalytics } from '@/components/analytics/sections'
import { ModuleSection } from '@/components/analytics/viz'
import { exportElementToPdf } from '@/lib/exportDashboardPdf'
import { Button } from '@/components/ui/button'
import { DASHBOARD_MODULES, type DashboardModule } from '@/components/dashboard/ModulePicker'

/** The analyses, in reading order (ids keep the old ?tab= links working). */
export const SECTIONS = [
  { id: 'stok', label: 'Stock Condition' },
  { id: 'pengadaan', label: 'Procurement' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'kartu-stock', label: 'Stock Card' },
] as const
export type SectionId = (typeof SECTIONS)[number]['id']

/** The analyses of the chosen app ("All": every one), for the one Dashboard. */
export function AnalyticsBody({ module }: { module: DashboardModule }) {
  const { hasPermission } = useAuth()
  const exportRootRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const chosen = DASHBOARD_MODULES.find((m) => m.key === module)
  const showStockCard = hasPermission('item.view') || hasPermission('inventory.view')
  const shows = (id: SectionId) => (!chosen || chosen.analytics.includes(id)) && (id !== 'kartu-stock' || showStockCard)
  if (!SECTIONS.some((s) => shows(s.id))) return null

  async function handleExportPdf() {
    if (!exportRootRef.current || exporting) return
    setExporting(true)
    try {
      await exportElementToPdf(exportRootRef.current, {
        title: `STOCKWISE Analytics${chosen ? ` — ${chosen.label}` : ''}`,
        subtitle: 'PT Surya Inti Gas',
        filename: `Analytics-${chosen?.label ?? 'STOCKWISE'}-${new Date().toISOString().slice(0, 10)}.pdf`,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <section id="analytics" aria-label="Analytics" className="scroll-mt-[calc(var(--sw-header)+1rem)] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Analytics{chosen ? ` · ${chosen.label}` : ''}</h2>
        <div className="ml-auto flex gap-2 print:hidden">
          <Button size="sm" variant="outline" onClick={handleExportPdf} disabled={exporting}>
            {exporting && <Loader2 className="size-4 animate-spin" />}{exporting ? 'Creating PDF…' : 'Download PDF'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      <div ref={exportRootRef} className="space-y-12">
        {shows('stok') && <div id="stok"><InventoryAnalytics /></div>}
        {shows('pengadaan') && <div id="pengadaan"><PurchaseAnalytics /></div>}
        {shows('tracking') && <div id="tracking"><TrackingAnalytics /></div>}
        {shows('kartu-stock') && (
          <div id="kartu-stock">
            <ModuleSection id="stock-card" title="Stock Card" description="Goods in and out over time, per project or per item.">
              <StockCardReport />
            </ModuleSection>
          </div>
        )}
      </div>
    </section>
  )
}
