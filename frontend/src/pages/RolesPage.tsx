import { useMemo, useState } from 'react'
import { Lock, Pencil, Plus, ShieldHalf, Trash2 } from 'lucide-react'
import {
  useCreateRole,
  useDeleteRole,
  usePermissions,
  useRoles,
  useUpdateRole,
  type PermissionItem,
  type RoleRow,
} from '@/features/admin/api'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { confirmDialog } from '@/components/ui/confirm'

/** The permission groups by the features they belong to, in the menu's order. */
const GROUP_LABEL: Record<string, string> = {
  profile: 'Profile & notifications',
  item_request: 'Item Request & Approval',
  npbg: 'Delivery Order',
  npbg_verification: 'Delivery Order item clarification',
  ppb: 'Purchase Request & Draft Purchase Request',
  purchasing: 'Purchase Order & RFQ',
  ri: 'Receipt',
  purchase_return: 'Return',
  stock_opname: 'Physical Inventory',
  item_inventory: 'Product Master, stock & Stock Card',
  important_request: 'Important Request (instructions & tasks)',
  tracking: 'Tracking & Analytics',
  mrp: 'Manufacturing',
  disassembly: 'Disassembly',
  dashboard_report: 'Dashboard, reports & export',
  master_data: 'Master data',
  accurate_sync: 'Sync Accurate',
  accurate_session: 'Accurate Connection',
  user_management: 'Users & roles',
  system: 'System',
}
const GROUP_ORDER = Object.keys(GROUP_LABEL)
const groupLabel = (g: string) => GROUP_LABEL[g] ?? g.replace(/_/g, ' ')

/** A role's tasks: its description, one point per line. */
function Points({ text, className }: { text: string | null; className?: string }) {
  const points = (text ?? '').split('\n').map((p) => p.trim()).filter(Boolean)
  if (points.length === 0) return <span className="text-xs text-muted-foreground">-</span>
  return (
    <ul className={className ?? 'list-disc space-y-0.5 pl-4 text-xs text-muted-foreground'}>
      {points.map((p, i) => <li key={i}>{p}</li>)}
    </ul>
  )
}

function RoleFormModal({ role, onClose }: { role?: RoleRow; onClose: () => void }) {
  const isEdit = !!role
  const readOnly = !!role?.is_locked
  const { data: groups } = usePermissions()
  const create = useCreateRole()
  const update = useUpdateRole()
  const [name, setName] = useState(role?.name ?? '')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState(role?.description ?? '')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(role?.permissions ?? []))
  const [filter, setFilter] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const visibleGroups = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return Object.entries(groups ?? {})
      .sort(([a], [b]) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99))
      .map(([group, items]) => [group, q && !groupLabel(group).toLowerCase().includes(q) ? items.filter((p) => p.slug.includes(q) || p.name.toLowerCase().includes(q)) : items] as [string, PermissionItem[]])
      .filter(([, items]) => items.length > 0)
  }, [groups, filter])

  const toggle = (slug: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(slug)) n.delete(slug)
      else n.add(slug)
      return n
    })

  const toggleGroup = (items: PermissionItem[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      items.forEach((p) => (on ? n.add(p.slug) : n.delete(p.slug)))
      return n
    })

  function submit() {
    setErr(null)
    const opts = { onSuccess: onClose, onError: (e: unknown) => setErr(apiErrorMessage(e)) }
    const permissions = [...selected]
    if (isEdit) update.mutate({ id: role.id, body: { name: name.trim(), description: description.trim() || null, permissions } }, opts)
    else create.mutate({ name: name.trim(), slug: slug.trim() || undefined, description: description.trim() || null, permissions }, opts)
  }

  return (
    <Modal page form
      open
      onClose={onClose}
      title={readOnly ? `Role ${role.name} (locked)` : isEdit ? `Edit Role — ${role.name}` : 'Add Role'}
      description={readOnly ? 'Super Admin always has all permissions and cannot be changed.' : undefined}
      className="max-w-3xl"
      footer={
        readOnly ? (
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={create.isPending || update.isPending || !name.trim()} onClick={submit}>Save</Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {!readOnly && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="r-name">Role name *</Label>
              <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {!isEdit ? (
              <div className="space-y-1">
                <Label htmlFor="r-slug">Role code (optional)</Label>
                <Input id="r-slug" placeholder="automatic from name, e.g. warehouse_staff" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Role code</Label>
                <div className="flex h-10 items-center text-sm text-muted-foreground">{role.slug}</div>
              </div>
            )}
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="r-desc">Role duties (one point per line)</Label>
              <Textarea id="r-desc" rows={4} maxLength={255} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder={'e.g.\nVerify Item Requests\nManage Product Master'} />
              <p className="text-right text-xs text-muted-foreground">{description.length}/255</p>
            </div>
          </div>
        )}

        {isEdit && role.is_system && !readOnly && (
          <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            This is a built-in role. Permission changes apply right away, but return to the default if the RBAC seeder is run again by a developer.
          </p>
        )}

        {!readOnly && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Permissions ({selected.size} selected)</Label>
              <Input placeholder="Search permissions…" className="h-8 max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <div className="max-h-[50vh] space-y-3 overflow-y-auto rounded-md border p-3">
              {visibleGroups.map(([group, items]) => {
                const allOn = items.every((p) => selected.has(p.slug))
                return (
                  <div key={group}>
                    <label className="mb-1 flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={allOn} onChange={() => toggleGroup(items, !allOn)} />
                      {groupLabel(group)}
                      <span className="text-xs font-normal text-muted-foreground">{items.filter((p) => selected.has(p.slug)).length}/{items.length}</span>
                    </label>
                    <div className="grid gap-1 pl-6 sm:grid-cols-2">
                      {items.map((p) => (
                        <label key={p.slug} className="flex cursor-pointer items-start gap-2 text-xs">
                          <input type="checkbox" className="mt-0.5" checked={selected.has(p.slug)} onChange={() => toggle(p.slug)} />
                          <span>
                            {p.name}
                            <span className="block text-[10px] text-muted-foreground">{p.slug}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
              {visibleGroups.length === 0 && <p className="text-sm text-muted-foreground">No matching permissions.</p>}
            </div>
          </div>
        )}

        {err && <p className="whitespace-pre-line text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

export function RolesPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('role.manage')
  const { data, isLoading } = useRoles()
  const del = useDeleteRole()
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null)

  async function remove(r: RoleRow) {
    if (!(await confirmDialog(`Delete role "${r.name}"?`))) return
    del.mutate(r.id)
  }

  const columns: Column<RoleRow>[] = [
    {
      key: 'name',
      header: 'Role',
      cell: (r) => (
        <div>
          <div className="flex items-center gap-1 font-medium">
            {r.is_locked && <Lock className="size-3 text-muted-foreground" />}
            {r.name}
          </div>
          <div className="text-[13px] text-muted-foreground">{r.slug}</div>
        </div>
      ),
    },
    { key: 'desc', header: 'Tasks', cell: (r) => <Points text={r.description} /> },
    { key: 'type', header: 'Type', cell: (r) => (r.is_system ? <Badge variant="neutral">Built-in</Badge> : <Badge variant="default">Custom</Badge>) },
    { key: 'perm', header: 'Permissions', cell: (r) => <span className="tabular-nums">{r.is_locked ? 'All' : r.permissions.length}</span> },
    { key: 'users', header: 'Users', cell: (r) => <span className="tabular-nums">{r.users_count}</span> },
    {
      key: 'actions',
      header: '',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" title={canManage && !r.is_locked ? 'Edit' : 'View'} onClick={() => setEditing(r)}>
            <Pencil className="size-4" />
          </Button>
          {canManage && !r.is_system && (
            <Button size="sm" variant="ghost" title="Delete" onClick={() => remove(r)} disabled={del.isPending}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Roles & Permissions"
        subtitle="Manage roles, their duties, and the access each role has"
        icon={<ShieldHalf className="size-5" />}
        actions={canManage ? <Button size="sm" onClick={() => setEditing('new')}><Plus className="size-4" /> Add Role</Button> : undefined}
      />
      <DataTable columns={columns} rows={data ?? []} rowKey={(r) => r.id} isLoading={isLoading} emptyText="No roles yet." />
      {editing && (
        canManage || editing === 'new'
          ? <RoleFormModal role={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
          : <RoleViewModal role={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

/** Read-only view for users with role.view but not role.manage. */
function RoleViewModal({ role, onClose }: { role: RoleRow; onClose: () => void }) {
  const { hasPermission } = useAuth()
  const { data: groups } = usePermissions(hasPermission('permission.view'))
  // the role's permissions by feature, with their names when the catalog can be read
  const byGroup = Object.entries(groups ?? {})
    .sort(([a], [b]) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99))
    .map(([g, items]) => [g, items.filter((p) => role.permissions.includes(p.slug))] as [string, PermissionItem[]])
    .filter(([, items]) => items.length > 0)
  return (
    <Modal open onClose={onClose} title={`Role ${role.name}`} className="max-w-2xl" footer={<Button variant="outline" size="sm" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div>
          <div className="mb-1 text-sm font-semibold">Tasks</div>
          <Points text={role.description} className="list-disc space-y-0.5 pl-5 text-sm" />
        </div>
        {role.is_locked ? (
          <p className="text-sm">Super Admin has all permissions.</p>
        ) : (
          <div className="max-h-[50vh] space-y-3 overflow-y-auto rounded-md border p-3">
            <div className="text-sm font-semibold">Permissions ({role.permissions.length})</div>
            {byGroup.length > 0 ? byGroup.map(([g, items]) => (
              <div key={g}>
                <div className="text-xs font-medium text-muted-foreground">{groupLabel(g)}</div>
                <ul className="list-disc pl-5 text-sm">{items.map((p) => <li key={p.slug}>{p.name}</li>)}</ul>
              </div>
            )) : (
              <div className="flex flex-wrap gap-1">{role.permissions.map((p) => <Badge key={p} variant="neutral">{p}</Badge>)}</div>
            )}
            {role.permissions.length === 0 && <p className="text-sm text-muted-foreground">No permissions.</p>}
          </div>
        )}
      </div>
    </Modal>
  )
}
