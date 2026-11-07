import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, Download, FolderKanban, Link2, Loader2, Pencil, Plus, Printer, Trash2 } from 'lucide-react'
import { apiErrorMessage } from '@/lib/api'
import { stockCardPdf, useDeleteStockCardProject, useStockCardProject, useStockCards, type StockCardListRow } from '@/features/stock-card/api'
import { CreateStockCardModal, ProjectModal } from '@/components/stock-card/StockCardModals'
import { ActionMenu, MobileBottomBar } from '@/components/stock-card/ActionMenu'
import { ShareLinksModal } from '@/components/stock-card/ShareLinksModal'
import { routePaths, useRoutePaths, useStockCardScope } from '@/features/stock-card/scope'
import { DataTable, type Column } from '@/components/DataTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BackLink } from '@/components/BackLink'
import { confirmDialog } from '@/components/ui/confirm'

const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 })

const columns = (cardPath: (id: number) => string): Column<StockCardListRow>[] => [
  { key: 'no', header: 'Card Number', cell: (r) => <Link to={cardPath(r.id)} className="text-[13px] font-medium text-primary hover:underline">{r.card_number}</Link> },
  { key: 'nama', header: 'Item Name', cell: (r) => r.item.description },
 { key: 'satuan', header: 'Unit', cell: (r) => r.item.unit ?? '' },
 { key: 'letak', header: 'Warehouse Location / Rack', cell: (r) => [r.location_warehouse, r.location_rack].filter(Boolean).join(' / ') || '' },
 { key: 'pj', header: 'Person in Charge', cell: (r) => r.person_in_charge ?? '' },
  { key: 'masuk', header: 'In', className: 'text-right', cell: (r) => <span className="tabular-nums">{nf.format(r.total_masuk)}</span> },
  { key: 'keluar', header: 'Out', className: 'text-right', cell: (r) => <span className="tabular-nums">{nf.format(r.total_keluar)}</span> },
  { key: 'sisa', header: 'Balance', className: 'text-right', cell: (r) => <span className="font-semibold tabular-nums">{nf.format(r.sisa)}</span> },
]

/** Phone: one tappable row per card — code, name, and the balance big on the right. */
function CardList({ rows, empty }: { rows: StockCardListRow[]; empty: string }) {
  const routes = useRoutePaths()
  if (rows.length === 0) return <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Link key={r.id} to={routes.card(r.id)} className="flex items-center gap-3 rounded-lg border bg-card p-3 active:bg-muted">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-primary">{r.card_number}</div>
            <div className="line-clamp-2 text-sm font-medium leading-snug">{r.item.description}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              In {nf.format(r.total_masuk)} · Out {nf.format(r.total_keluar)}{r.person_in_charge ? ` · ${r.person_in_charge}` : ''}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xl font-bold tabular-nums leading-none">{nf.format(r.sisa)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">balance {r.item.unit ?? ''}</div>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      ))}
    </div>
  )
}

/** Cards made before projects existed: listed so each can be moved into a project. */
function UnassignedCards() {
  const navigate = useNavigate()
  const { data, isLoading } = useStockCards('', 1, 'none')
  const rows = data?.data ?? []
  return (
    <div className="space-y-4">
      <BackLink keep to="/stock-card" label="Project List" />
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Cards not in a project yet</h1>
      </div>
      <div className="md:hidden">{isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <CardList rows={rows} empty="None." />}</div>
      <div className="hidden md:block">
        <DataTable columns={columns(routePaths({ kind: 'auth' }).card)} rows={rows} rowKey={(r) => r.id} isLoading={isLoading} scrollMemoryKey="stock-card-project:none" onRowClick={(r) => navigate(`/stock-card/${r.id}`)} emptyText="None." />
      </div>
    </div>
  )
}

export function StockCardProjectPage() {
  const { projectId } = useParams()
  if (projectId === 'none') return <UnassignedCards />
  return <ProjectView id={Number(projectId)} />
}

/** The cards of a project — logged in, or through a share link (no account). */
export function ProjectView({ id }: { id: number | null }) {
  const navigate = useNavigate()
  const scope = useStockCardScope()
  const shared = scope.kind === 'share'
  const routes = routePaths(scope)
  const { data: p, isLoading, error } = useStockCardProject(id)
  const del = useDeleteStockCardProject(id ?? 0)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [pdfBusy, setPdfBusy] = useState<'print' | 'download' | null>(null)

  if (isLoading) return <p className="text-muted-foreground">Loading projects…</p>
  if (error || !p) return <p className="text-destructive">{error ? apiErrorMessage(error) : 'Project not found.'}</p>

  async function pdf(mode: 'print' | 'download') {
    setPdfBusy(mode)
    try {
      await stockCardPdf(scope, { projectId: p!.id, name: p!.code || p!.name }, mode)
    } catch (e) {
      window.alert(apiErrorMessage(e))
    } finally {
      setPdfBusy(null)
    }
  }
  const remove = async () => {
    if ((await confirmDialog(`Delete project ${p.name}?`))) del.mutate(undefined, { onSuccess: () => navigate('/stock-card'), onError: (e) => window.alert(apiErrorMessage(e)) })
  }
  const empty = p.cards.length === 0
  const canCreate = p.can_create_card ?? p.can_edit

  return (
    <div className="space-y-4 pb-24 md:pb-0">
      <div className="flex items-center justify-between gap-2">
        {shared ? <span /> : <BackLink keep to="/stock-card" label="Project List" />}
        <ActionMenu className="md:hidden" actions={[
          ...(p.can_edit && !shared ? [{ label: 'Share link', icon: <Link2 className="size-4" />, onClick: () => setSharing(true) }] : []),
          { label: pdfBusy === 'print' ? 'Preparing…' : 'Print all cards', icon: <Printer className="size-4" />, onClick: () => void pdf('print'), disabled: empty || !!pdfBusy },
          { label: pdfBusy === 'download' ? 'Preparing…' : 'Download all as PDF', icon: <Download className="size-4" />, onClick: () => void pdf('download'), disabled: empty || !!pdfBusy },
          ...(p.can_edit ? [{ label: 'Edit project', icon: <Pencil className="size-4" />, onClick: () => setEditing(true) }] : []),
          ...(p.can_edit && empty ? [{ label: 'Delete project', icon: <Trash2 className="size-4" />, onClick: remove, danger: true }] : []),
        ]} />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-start gap-2 text-xl font-semibold leading-tight"><FolderKanban className="mt-0.5 size-5 shrink-0 text-primary" /> {p.name}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {p.code && <span className="">{p.code}</span>}
            <Badge variant={p.status === 'ACTIVE' ? 'default' : 'neutral'}>{p.status === 'ACTIVE' ? 'Running' : 'Done'}</Badge>
            <span>{p.cards.length} stock card</span>
          </p>
        </div>
        <div className="hidden flex-wrap gap-2 md:flex">
          {canCreate && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> Create Stock Card</Button>}
          {p.can_edit && !shared && <Button variant="outline" onClick={() => setSharing(true)}><Link2 className="size-4" /> Share link</Button>}
          <Button variant="outline" onClick={() => void pdf('print')} disabled={pdfBusy !== null || empty}>
            {pdfBusy === 'print' ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} Print all
          </Button>
          <Button variant="outline" onClick={() => void pdf('download')} disabled={pdfBusy !== null || empty}>
            {pdfBusy === 'download' ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download All PDF
          </Button>
          {p.can_edit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit project</Button>}
          {p.can_edit && empty && <Button variant="outline" className="text-destructive" onClick={remove}><Trash2 className="size-4" /> Delete</Button>}
        </div>
      </div>

      <div className="md:hidden">
 <CardList rows={p.cards} empty={canCreate ? 'No cards yet. Tap "New stock card" below, one card per item.' : 'No cards in this project yet.'} />
      </div>
      <div className="hidden md:block">
        <DataTable columns={columns(routes.card)} rows={p.cards} rowKey={(r) => r.id} scrollMemoryKey={`stock-card-project:${p.id}`} onRowClick={(r) => navigate(routes.card(r.id))}
 emptyText={canCreate ? 'No cards in this project yet. Click "Create Stock Card", one card per item.' : 'No cards in this project yet.'} />
      </div>

      {canCreate && (
        <MobileBottomBar>
          <Button className="h-12 w-full text-base" onClick={() => setCreating(true)}><Plus className="size-5" /> New stock card</Button>
        </MobileBottomBar>
      )}
      {creating && <CreateStockCardModal project={p} open onClose={() => setCreating(false)} />}
      {editing && <ProjectModal project={p} open onClose={() => setEditing(false)} />}
      {sharing && <ShareLinksModal project={p} open onClose={() => setSharing(false)} />}
    </div>
  )
}
