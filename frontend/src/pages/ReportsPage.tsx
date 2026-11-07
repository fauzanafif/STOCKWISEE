import { useState } from 'react'
import { Archive, Download, FileSpreadsheet, FileText, Printer, Sheet } from 'lucide-react'
import { api, apiErrorMessage } from '@/lib/api'
import { useAuth } from '@/auth/AuthContext'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Dataset {
  key: string
  label: string
  description: string
  permission: string
}

const DATASETS: Dataset[] = [
  { key: 'inventory', label: 'Inventory', description: 'Actual, reserved & available stock per warehouse', permission: 'report.inventory' },
  { key: 'inventory_analysis', label: 'Inventory Analysis', description: 'Stock status vs. safety stock & purchase recommendation (real-time)', permission: 'inventory.view_analysis' },
  { key: 'npbg', label: 'Delivery Order', description: 'Mirror of ARINV/ARINVDET from Accurate', permission: 'report.npbg' },
  { key: 'ppb', label: 'Purchase Request', description: 'Mirror of REQUISITION/REQUISITIONDET from Accurate', permission: 'report.ppb' },
  { key: 'purchase-orders', label: 'Purchase Order', description: 'Purchase orders to vendors (Accurate & internal)', permission: 'po.view' },
  { key: 'ri', label: 'Receipt', description: 'Mirror of APINV/APITMDET from Accurate', permission: 'report.ri' },
  { key: 'stock-opnames', label: 'Physical Inventory', description: 'Opname history & differences', permission: 'report.opname' },
  { key: 'stock-movements', label: 'Stock Movement', description: 'Full stock card / ledger', permission: 'report.stock_movement' },
]

interface LegacyFile {
  key: string
  label: string
  filename: string
  description: string
  anyOf: string[]
}

/** 9 file Excel lama PT Surya Inti Gas — direplika sama persis (sheet/kolom/rumus), diisi data live. */
const LEGACY_FILES: LegacyFile[] = [
  { key: 'data', label: 'Item Master & Safety Stock', filename: 'DATA.xlsx', description: 'MAIN DATABASE + 12 SAFETY STOCK sheets (original formulas, ~1 minute to create)', anyOf: ['report.inventory'] },
  { key: 'npbg', label: 'Delivery Order', filename: '2. NPBG.xlsx', description: 'Delivery Order (NPBG) legacy file', anyOf: ['report.npbg'] },
  { key: 'borrow-lend', label: 'Borrow & Lend Tracking', filename: '3. Tracking Borrow & Lend.xlsx', description: 'Lend, Borrow sheets', anyOf: ['lend.view', 'borrow.view'] },
  { key: 'stpp', label: 'Tracking STPP', filename: '4. Tracking STPP.xlsx', description: 'Loan-for-Use Handover', anyOf: ['stpp.view'] },
  { key: 'ban-luar', label: 'Outer Tyre Tracking', filename: '5. Tracking Ban Luar.xlsx', description: 'Vehicle tyre replacement', anyOf: ['tyre.view'] },
  { key: 'maintenance-assets', label: 'Maintenance Assets Tracking', filename: '6. Tracking Maintenance Assets.xlsx', description: 'Asset/vehicle repair SPK', anyOf: ['maintenance.view'] },
  { key: 'manufaktur-assembly', label: 'Manufacturing & Assembly Tracking', filename: '7. Tracking Manufaktur & Assembly.xlsx', description: 'Manufacturing & Assembly, Manufacturing & Services sheets', anyOf: ['manufacturing.view'] },
  { key: 'pengembalian-bekas', label: 'Used Item Return Tracking', filename: '8. Tracking Pengembalian Bekas.xlsx', description: 'Spare Part (matrix), Other Spare Part sheets', anyOf: ['used_return.view'] },
]

const FORMATS = [
  { key: 'xlsx', label: 'Excel', icon: FileSpreadsheet, perm: 'export.excel' },
  { key: 'csv', label: 'CSV', icon: Sheet, perm: 'export.csv' },
  { key: 'pdf', label: 'PDF', icon: FileText, perm: 'export.pdf' },
] as const

export function ReportsPage() {
  const { hasPermission } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const datasets = DATASETS.filter((d) => hasPermission(d.permission))
  const legacyFiles = LEGACY_FILES.filter((f) => hasPermission('export.excel') && f.anyOf.some((p) => hasPermission(p)))

  async function downloadLegacy(file: LegacyFile) {
    const id = `legacy:${file.key}`
    setBusy(id)
    setErr(null)
    try {
      const res = await api.get(`/api/legacy-export/${file.key}`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function download(dataset: string, format: string) {
    setBusy(`${dataset}:${format}`)
    setErr(null)
    try {
      const res = await api.get(`/api/export/${dataset}`, { params: { format }, responseType: 'blob' })
      const disposition = String(res.headers['content-disposition'] ?? '')
      const match = disposition.match(/filename="?([^"]+)"?/)
      const name = match?.[1] ?? `${dataset}.${format === 'pdf' ? 'html' : format}`
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setErr(apiErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function print(dataset: string) {
    const id = `${dataset}:print`
    setBusy(id)
    setErr(null)
    const w = window.open('', '_blank')
    try {
      const res = await api.get(`/api/export/${dataset}`, { params: { format: 'pdf' }, responseType: 'text' })
      if (w) {
        w.document.write(res.data as string)
        w.document.close()
      }
    } catch (e) {
      w?.close()
      setErr(apiErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports & Export"
        subtitle="Download STOCKWISE data as Excel, CSV, or PDF"
        icon={<Download className="size-5" />}
      />

      {err && <p className="text-sm text-destructive">{err}</p>}
      <p className="text-xs text-muted-foreground">
        The PDF format downloads as a print page; open the file and use “Save as PDF” in the browser print dialog.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {datasets.map((d) => (
          <Card key={d.key}>
            <CardContent className="space-y-3 p-4">
              <div>
                <div className="font-medium">{d.label}</div>
                <div className="text-sm text-muted-foreground">{d.description}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {FORMATS.filter((f) => hasPermission(f.perm)).map((f) => {
                  const Icon = f.icon
                  const id = `${d.key}:${f.key}`
                  return (
                    <Button
                      key={f.key}
                      size="sm"
                      variant="outline"
                      disabled={busy === id}
                      onClick={() => download(d.key, f.key)}
                    >
                      <Icon className="size-4" />
                      {busy === id ? 'Preparing…' : f.label}
                    </Button>
                  )
                })}
                {hasPermission('export.pdf') && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === `${d.key}:print`}
                    onClick={() => print(d.key)}
                  >
                    <Printer className="size-4" />
                    {busy === `${d.key}:print` ? 'Preparing…' : 'Print'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {datasets.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            You have no access to reports.
          </CardContent>
        </Card>
      )}

      {legacyFiles.length > 0 && (
        <>
          <PageHeader
            title="Classic Excel"
            subtitle="Replica of 9 old Excel files; identical sheets, columns & formulas, filled with live STOCKWISE data"
            icon={<Archive className="size-5" />}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {legacyFiles.map((f) => {
              const id = `legacy:${f.key}`
              return (
                <Card key={f.key}>
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <div className="font-medium">{f.label}</div>
                      <div className="text-[13px] text-muted-foreground">{f.filename}</div>
                      <div className="text-xs text-muted-foreground">{f.description}</div>
                    </div>
                    <Button size="sm" variant="outline" disabled={busy === id} onClick={() => downloadLegacy(f)}>
                      <FileSpreadsheet className="size-4" />
                      {busy === id ? 'Preparing…' : 'Download'}
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
