import { useEffect, useState } from 'react'
import { Building2, Pencil, Plus } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useSaveVendor, useVendors, type Vendor } from '@/features/purchasing/api'
import { apiErrorMessage } from '@/lib/api'
import { invalidTo, toast } from '@/lib/notify'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { FilterBar } from '@/components/FilterBar'
import { ColumnMenu, useHiddenColumns, visibleColumns } from '@/components/ColumnVisibility'
import { Modal } from '@/components/ui/modal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

type Draft = { id?: number; name: string; code: string; phone: string; email: string; address: string; is_active: boolean }
const EMPTY: Draft = { name: '', code: '', phone: '', email: '', address: '', is_active: true }

/** Add / edit one vendor or supplier. */
function VendorForm({ open, vendor, onClose }: { open: boolean; vendor: Vendor | null; onClose: () => void }) {
  const save = useSaveVendor()
  const [d, setD] = useState<Draft>(EMPTY)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setErr(null)
    setD(vendor ? { id: vendor.id, name: vendor.name, code: vendor.code ?? '', phone: vendor.phone ?? '', email: vendor.email ?? '', address: vendor.address ?? '', is_active: vendor.is_active } : EMPTY)
  }, [open, vendor])
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setD((x) => ({ ...x, [k]: e.target.value }))

  const submit = () => {
    setErr(null)
    if (!d.name.trim()) return invalidTo(setErr, 'The vendor / supplier name is required.')
    save.mutate({
      id: d.id, name: d.name.trim(), code: d.code.trim() || null, phone: d.phone.trim() || null, email: d.email.trim() || null,
      address: d.address.trim() || null, ...(d.id ? { is_active: d.is_active } : {}),
    }, {
      onSuccess: () => { toast.success(d.id ? 'Vendor / supplier updated.' : 'Vendor / supplier added.'); onClose() },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  return (
    <Modal form open={open} onClose={onClose} title={vendor ? `Edit ${vendor.name}` : 'Add Vendor / Supplier'} className="max-w-lg"
      description="One master for vendors and suppliers: used in PO, Receipt, and Return."
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
      </>}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="v-name">Name *</Label>
          {/* the Accurate sync finds its vendors by name: renamed here it would come back as a second one */}
          <Input id="v-name" value={d.name} maxLength={200} onChange={set('name')} placeholder="e.g. CV. ANDALAN TATA JAYA" disabled={vendor?.source === 'accurate'} />
          {vendor?.source === 'accurate' && <p className="text-xs text-muted-foreground">Vendor from Accurate: its name is changed in Accurate.</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="v-code">Code</Label><Input id="v-code" value={d.code} maxLength={30} onChange={set('code')} /></div>
          <div className="space-y-1.5"><Label htmlFor="v-phone">Phone</Label><Input id="v-phone" value={d.phone} maxLength={40} onChange={set('phone')} /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="v-email">Email</Label><Input id="v-email" type="email" value={d.email} maxLength={150} onChange={set('email')} /></div>
        <div className="space-y-1.5"><Label htmlFor="v-addr">Address</Label><Input id="v-addr" value={d.address} maxLength={255} onChange={set('address')} /></div>
        {vendor && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={d.is_active} onChange={(e) => setD((x) => ({ ...x, is_active: e.target.checked }))} /> Active
          </label>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

/** Master Vendor & Supplier: one list for both (the vendors from Accurate and the ones added here). */
export function VendorsPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('master.vendor.manage')
  const [search, setSearch] = useState('')
  const [typed, setTyped] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Vendor | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  useEffect(() => { const t = setTimeout(() => setSearch(typed), 300); return () => clearTimeout(t) }, [typed])
  const { data, isLoading } = useVendors({ search: search || undefined, is_active: status || undefined, limit: 2000 })
  const rows = data ?? []

  const columns: Column<Vendor>[] = [
    { key: 'name', header: 'Name', cell: (v) => <span className="font-medium">{v.name}</span> },
    { key: 'code', header: 'Code', cell: (v) => <span className="text-[13px]">{v.code ?? ''}</span> },
    { key: 'phone', header: 'Phone', cell: (v) => <span className="whitespace-nowrap">{v.phone ?? ''}</span> },
    { key: 'email', header: 'Email', cell: (v) => v.email ?? '' },
    { key: 'address', header: 'Address', className: 'max-w-xs', cell: (v) => <span className="block truncate" title={v.address ?? undefined}>{v.address ?? ''}</span> },
    { key: 'source', header: 'Source', cell: (v) => <Badge variant="neutral">{v.source === 'accurate' ? 'Accurate' : 'STOCKWISE'}</Badge> },
    {
      key: 'status', header: 'Status',
      cell: (v) => <span className="inline-flex gap-1">{v.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>}{v.needs_review && <Badge variant="warning">Needs checking</Badge>}</span>,
    },
    ...(canManage ? [{
      key: 'aksi', header: <span className="sr-only">Actions</span>, className: 'text-right',
      cell: (v: Vendor) => <Button size="sm" variant="ghost" className="h-8" onClick={() => { setEditing(v); setFormOpen(true) }}><Pencil className="size-3.5" /> Edit</Button>,
    }] : []),
  ]
  const [hiddenCols, toggleCol] = useHiddenColumns('stockwise:vendor-hidden-columns')

  return (
    <div className="space-y-4">
      <PageHeader title="Master Data · Vendors & Suppliers" icon={<Building2 className="size-5" />}
        subtitle="One master for vendors and suppliers: from Accurate and added in STOCKWISE."
        actions={canManage && <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}><Plus className="size-4" /> Add</Button>} />

      <FilterBar end={<>
        <span className="text-xs text-muted-foreground">{rows.length.toLocaleString('id-ID')} vendor / supplier</span>
        <ColumnMenu columns={columns} hiddenCols={hiddenCols} onToggle={toggleCol} alwaysVisible={['name', 'aksi']} hint="Select the columns shown in the table." />
      </>}>
        <Input className="w-full sm:max-w-sm" placeholder="Search name, code, phone, email, address…" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <div className="w-full sm:w-44">
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </Select>
        </div>
      </FilterBar>

      <DataTable columns={visibleColumns(columns, hiddenCols, ['name', 'aksi'])} rows={rows} rowKey={(v) => v.id} isLoading={isLoading}
        emptyText={search || status ? 'No vendors / suppliers for this filter.' : 'No vendors / suppliers yet.'} />

      <VendorForm open={formOpen} vendor={editing} onClose={() => setFormOpen(false)} />
    </div>
  )
}
