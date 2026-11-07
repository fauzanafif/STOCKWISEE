import { useEffect, useMemo, useState } from 'react'
import { FolderTree, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { CATEGORY_LEVELS, useItemCategories, useItemCategoryMutations, type CategoryLevel, type ItemCategory } from '@/features/itemCategories/api'
import { apiErrorMessage } from '@/lib/api'
import { invalidTo, toast } from '@/lib/notify'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { Modal } from '@/components/ui/modal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { confirmDialog } from '@/components/ui/confirm'
import { cn } from '@/lib/utils'

/** Add / edit one category of the picked level. */
function CategoryForm({ level, category, preset, open, onClose }: { level: CategoryLevel; category: ItemCategory | null; preset?: string; open: boolean; onClose: () => void }) {
  const m = useItemCategoryMutations()
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setErr(null)
    setName(category?.name ?? preset ?? '')
    setPrefix(category?.code_prefix ?? '')
  }, [open, category, preset])
  const label = CATEGORY_LEVELS.find((l) => l.level === level)!.label
  const busy = m.create.isPending || m.update.isPending

  const submit = () => {
    setErr(null)
    if (!name.trim()) return invalidTo(setErr, 'The category name is required.')
    const code_prefix = level === 'induk' ? prefix.trim() || null : undefined
    if (category) {
      m.update.mutate({ id: category.id, name: name.trim(), ...(level === 'induk' ? { code_prefix } : {}) }, {
        onSuccess: (r) => { toast.success(r.items_moved ? `Category updated, ${r.items_moved} items change too.` : 'Category updated.'); onClose() },
        onError: (e) => setErr(apiErrorMessage(e)),
      })
    } else {
      m.create.mutate({ level, name: name.trim(), code_prefix }, { onSuccess: onClose, onError: (e) => setErr(apiErrorMessage(e)) })
    }
  }

  return (
    <Modal form open={open} onClose={onClose} title={category ? `Edit ${category.name}` : `Add ${label}`} className="max-w-lg"
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </>}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="c-name">Name *</Label>
          <Input id="c-name" autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          {category && category.items_count > 0 && name.trim() !== category.name && (
            <p className="text-xs text-amber-700">{category.items_count.toLocaleString('id-ID')} items use this category and are renamed with it.</p>
          )}
        </div>
        {level === 'induk' && (
          <div className="space-y-1.5">
            <Label htmlFor="c-prefix">Item code prefix</Label>
            <Input id="c-prefix" value={prefix} maxLength={60} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="e.g. MNA, MAA" className="" />
          </div>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

/** Master Kategori Barang: the choices of Kategori Induk / Anak 1 / 2 / 3 in the Master Produk form. */
export function ItemCategoriesPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('master.category.manage')
  const [level, setLevel] = useState<CategoryLevel>('induk')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<ItemCategory | null>(null)
  const [preset, setPreset] = useState<string | undefined>()
  const [formOpen, setFormOpen] = useState(false)
  const { data, isLoading } = useItemCategories(level)
  const m = useItemCategoryMutations()

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.data ?? []).filter((c) => (!q || c.name.toLowerCase().includes(q) || (c.code_prefix ?? '').toLowerCase().includes(q))
      && (!status || (status === '1') === c.is_active))
  }, [data, search, status])
  const unlisted = data?.unlisted ?? []

  const openForm = (c: ItemCategory | null, name?: string) => { setEditing(c); setPreset(name); setFormOpen(true) }
  const toggle = (c: ItemCategory) => m.update.mutate({ id: c.id, is_active: !c.is_active }, {
    onSuccess: () => toast.success(c.is_active ? `${c.name} deactivated.` : `${c.name} activated.`),
    onError: (e) => toast.error(apiErrorMessage(e)),
  })

  const columns: Column<ItemCategory>[] = [
    { key: 'name', header: 'Name', cell: (c) => <span className="font-medium">{c.name}</span> },
    ...(level === 'induk' ? [{ key: 'prefix', header: 'Code prefix', cell: (c: ItemCategory) => <span className="text-[13px]">{c.code_prefix?.split(',').join(', ') ?? ''}</span> }] : []),
    { key: 'count', header: 'Item count', className: 'text-right', cell: (c) => <span className="tabular-nums">{c.items_count.toLocaleString('id-ID')}</span> },
    { key: 'status', header: 'Status', cell: (c) => c.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge> },
    ...(canManage ? [{
      key: 'aksi', header: <span className="sr-only">Actions</span>, className: 'text-right',
      cell: (c: ItemCategory) => (
        <span className="inline-flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8" onClick={() => openForm(c)}><Pencil className="size-3.5" /> Edit</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => toggle(c)}>{c.is_active ? 'Deactivate' : 'Activate'}</Button>
          {c.items_count === 0 && (
            <Button size="sm" variant="ghost" className="h-8 text-muted-foreground hover:text-destructive" aria-label={`Delete ${c.name}`}
              onClick={async () => { if (await confirmDialog({ message: `Delete category ${c.name}?`, danger: true })) m.remove.mutate(c.id, { onError: (e) => toast.error(apiErrorMessage(e)) }) }}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </span>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="Master Data · Item Categories" icon={<FolderTree className="size-5" />}
        subtitle="Main Category and Sub Category 1 / 2 / 3 options in the Product Master."
        actions={canManage && <Button size="sm" onClick={() => openForm(null)}><Plus className="size-4" /> Add</Button>} />

      <div className="flex gap-1 overflow-x-auto border-b" role="tablist">
        {CATEGORY_LEVELS.map((l) => (
          <button key={l.level} type="button" role="tab" aria-selected={level === l.level} onClick={() => { setLevel(l.level); setSearch('') }}
            className={cn('-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors', level === l.level ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {l.label}
          </button>
        ))}
      </div>

      <FilterBar end={<span className="text-xs text-muted-foreground">{rows.length.toLocaleString('id-ID')} categories</span>}>
        <Input className="w-full sm:max-w-sm" placeholder={level === 'induk' ? 'Search name or prefix…' : 'Search category name…'} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="w-full sm:w-44">
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </Select>
        </div>
      </FilterBar>

      {unlisted.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <div className="mb-2 text-sm font-medium text-amber-900">Used by items, not in the list yet ({unlisted.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {unlisted.map((u) => (
              <span key={u.name} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs">
                {u.name} <span className="text-muted-foreground">· {u.items_count}</span>
                {canManage && <button type="button" className="font-medium text-primary hover:underline" onClick={() => openForm(null, u.name)}>Add</button>}
              </span>
            ))}
          </div>
        </div>
      )}

      <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} isLoading={isLoading}
        emptyText={search || status ? 'No categories for this filter.' : 'No categories yet.'} />

      <CategoryForm level={level} category={editing} preset={preset} open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  )
}
