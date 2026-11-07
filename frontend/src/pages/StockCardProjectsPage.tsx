import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpenCheck, ChevronRight, FolderKanban, Plus, Search } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useStockCardProjects, type StockCardProject } from '@/features/stock-card/api'
import { ProjectModal } from '@/components/stock-card/StockCardModals'
import { MobileBottomBar } from '@/components/stock-card/ActionMenu'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRemembered } from '@/lib/listMemory'

const statusBadge = (s: string) => <Badge variant={s === 'ACTIVE' ? 'default' : 'neutral'}>{s === 'ACTIVE' ? 'Running' : 'Done'}</Badge>

export function StockCardProjectsPage() {
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useRemembered('stock-card-projects', 'search', '')
  const [creating, setCreating] = useState(false)
  const { data, isLoading } = useStockCardProjects(search)
  const canEdit = hasPermission('item.update')
  const projects = data?.data ?? []

  const columns: Column<StockCardProject>[] = [
    { key: 'name', header: 'Project', cell: (r) => <Link to={`/stock-card/project/${r.id}`} className="font-medium text-primary hover:underline">{r.name}</Link> },
 { key: 'code', header: 'Code', cell: (r) => <span className="text-[13px]">{r.code ?? ''}</span> },
    { key: 'cards', header: 'Card Count', className: 'text-right', cell: (r) => <span className="tabular-nums">{r.cards_count}</span> },
    { key: 'status', header: 'Status', cell: (r) => statusBadge(r.status) },
  ]

  return (
    <div className="space-y-4 pb-24 md:pb-0">
      <PageHeader
        title="Stock Card"
 subtitle="Per project; one project holds many cards, one card per item"
        icon={<BookOpenCheck className="size-5" />}
        actions={canEdit ? <Button className="hidden md:inline-flex" onClick={() => setCreating(true)}><Plus className="size-4" /> Create Project</Button> : undefined}
      />
      <div className="relative md:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-11 pl-9 md:h-10" placeholder="Search project name / code…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {(data?.unassigned_cards ?? 0) > 0 && (
        <Button asChild size="sm" variant="outline" className="w-fit">
          <Link to="/stock-card/project/none"><FolderKanban className="size-4" /> No project <span className="tabular-nums text-muted-foreground">{data!.unassigned_cards}</span></Link>
        </Button>
      )}

      {/* phone: one tappable card per project */}
      <div className="space-y-2 md:hidden">
        {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && projects.length === 0 && (
          <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            {search ? 'No matching projects.' : 'No projects yet. Tap "New project" below.'}
          </p>
        )}
        {projects.map((p) => (
          <Link key={p.id} to={`/stock-card/project/${p.id}`} className="flex items-center gap-3 rounded-lg border bg-card p-3.5 active:bg-muted">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FolderKanban className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{p.name}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                {p.code && <span className="">{p.code}</span>}
                <span>{p.cards_count} cards</span>
                {statusBadge(p.status)}
              </div>
            </div>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>

      {/* desktop: table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={projects} rowKey={(r) => r.id} isLoading={isLoading} scrollMemoryKey="stock-card-projects"
          onRowClick={(r) => navigate(`/stock-card/project/${r.id}`)}
          emptyText={search ? 'No matching projects.' : 'No projects yet. Click "Create Project", then create a stock card for each item.'} />
      </div>

      {canEdit && (
        <MobileBottomBar>
          <Button className="h-12 w-full text-base" onClick={() => setCreating(true)}><Plus className="size-5" /> New project</Button>
        </MobileBottomBar>
      )}
      {creating && <ProjectModal open onClose={() => setCreating(false)} onSaved={(p) => navigate(`/stock-card/project/${p.id}`)} />}
    </div>
  )
}
