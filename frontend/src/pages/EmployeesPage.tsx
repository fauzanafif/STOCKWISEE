import { useEffect, useState } from 'react'
import { Download, FileUp, Pencil, Plus, UserRound } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useAddDepartment, useEmployeeDepartments, useEmployees, useEmployeeUsers, useSaveEmployee, downloadEmployeeTemplate, useImportEmployees, type Employee } from '@/features/employees/api'
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

type Draft = { id?: number; name: string; position: string; phone_wa: string; phone_office: string; department_id: string; user_id: string; is_active: boolean }
const EMPTY: Draft = { name: '', position: '', phone_wa: '', phone_office: '', department_id: '', user_id: '', is_active: true }

/** Add / edit one worker. */
function EmployeeForm({ open, employee, onClose }: { open: boolean; employee: Employee | null; onClose: () => void }) {
  const save = useSaveEmployee()
  const { data: departments } = useEmployeeDepartments()
  const { data: users } = useEmployeeUsers(open)
  const [d, setD] = useState<Draft>(EMPTY)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setErr(null)
    setD(employee ? {
      id: employee.id, name: employee.name, position: employee.position ?? '', phone_wa: employee.phone_wa ?? '', phone_office: employee.phone_office ?? '',
      department_id: employee.department_id ? String(employee.department_id) : '', user_id: employee.user_id ? String(employee.user_id) : '', is_active: employee.is_active,
    } : EMPTY)
  }, [open, employee])
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD((x) => ({ ...x, [k]: e.target.value }))
  // a divisi not in the list yet: added here, then picked for this worker
  const addDept = useAddDepartment()
  const [addingDiv, setAddingDiv] = useState(false)
  const [newDiv, setNewDiv] = useState('')
  useEffect(() => { if (open) setAddingDiv(false) }, [open])
  const saveDiv = () => {
    setErr(null)
    if (!newDiv.trim()) return invalidTo(setErr, 'Fill in the new division name.')
    addDept.mutate(newDiv.trim(), {
      onSuccess: (dep) => { setD((x) => ({ ...x, department_id: String(dep.id) })); setAddingDiv(false); toast.success(`Division ${dep.name} selected.`) },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  const submit = () => {
    setErr(null)
    if (!d.name.trim()) return invalidTo(setErr, 'The employee name is required.')
    save.mutate({
      id: d.id, name: d.name.trim(), position: d.position.trim() || null, phone_wa: d.phone_wa.trim() || null, phone_office: d.phone_office.trim() || null,
      department_id: d.department_id ? Number(d.department_id) : null, user_id: d.user_id ? Number(d.user_id) : null,
      ...(d.id ? { is_active: d.is_active } : {}),
    }, {
      onSuccess: () => { toast.success(d.id ? 'Employee data updated.' : 'Employee added.'); onClose() },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  return (
    <Modal form open={open} onClose={onClose} title={employee ? `Edit ${employee.name}` : 'Add Employee'} className="max-w-lg"
      description="Company employee data: name, position, division, and STOCKWISE account (if any)."
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
      </>}>
      <div className="space-y-3">
        <div className="space-y-1.5"><Label htmlFor="e-name">Name *</Label><Input id="e-name" value={d.name} maxLength={150} onChange={set('name')} placeholder="Full name" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="e-pos">Position</Label><Input id="e-pos" value={d.position} maxLength={100} onChange={set('position')} placeholder="e.g. Driver" /></div>
          <div className="space-y-1.5"><Label htmlFor="e-phone-wa">WA No</Label><Input id="e-phone-wa" value={d.phone_wa} maxLength={40} onChange={set('phone_wa')} placeholder="628..." /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="e-phone-office">Office Phone</Label><Input id="e-phone-office" value={d.phone_office} maxLength={40} onChange={set('phone_office')} placeholder="021..." /></div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="e-div">Division</Label>
            {!addingDiv && <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => { setAddingDiv(true); setNewDiv('') }}>+ New division</button>}
          </div>
          {addingDiv ? (
            <div className="flex gap-2">
              <Input id="e-div" autoFocus value={newDiv} maxLength={100} onChange={(e) => setNewDiv(e.target.value)} placeholder="e.g. DIRECTOR"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveDiv() } if (e.key === 'Escape') { e.stopPropagation(); setAddingDiv(false) } }} />
              <Button type="button" size="sm" className="h-9" onClick={saveDiv} disabled={addDept.isPending}>{addDept.isPending ? 'Saving…' : 'Add'}</Button>
              <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => setAddingDiv(false)}>Cancel</Button>
            </div>
          ) : (
            <Select id="e-div" value={d.department_id} onChange={set('department_id')}>
              <option value="">— select —</option>
              {(departments ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          )}
        </div>
        <div className="space-y-1.5"><Label htmlFor="e-user">STOCKWISE account</Label>
          <Select id="e-user" value={d.user_id} onChange={set('user_id')}>
            <option value="">No account</option>
            {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}
          </Select>
        </div>
        {employee && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={d.is_active} onChange={(e) => setD((x) => ({ ...x, is_active: e.target.checked }))} /> Active (still working)
          </label>
        )}
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

/** Master Data · Data Pekerja: the people of the company. */
export function EmployeesPage() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('master.employee.manage')
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [division, setDivision] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Employee | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const importEmployees = useImportEmployees()
  useEffect(() => { const t = setTimeout(() => setSearch(typed), 300); return () => clearTimeout(t) }, [typed])
  const { data: departments } = useEmployeeDepartments()
  const { data, isLoading } = useEmployees({ search: search || undefined, department_id: division || undefined, is_active: status || undefined })
  const rows = data ?? []

  const columns: Column<Employee>[] = [
    { key: 'name', header: 'Name', cell: (e) => <span className="font-medium">{e.name}</span>, className: 'min-w-[14rem]' },
    { key: 'position', header: 'Position', cell: (e) => e.position ?? '' },
    { key: 'department', header: 'Division', cell: (e) => <span className="whitespace-nowrap">{e.department ?? ''}</span> },
    { key: 'phone_wa', header: 'WA No', cell: (e) => <span className="whitespace-nowrap">{e.phone_wa ?? ''}</span> },
    { key: 'phone_office', header: 'Office Phone', cell: (e) => <span className="whitespace-nowrap">{e.phone_office ?? ''}</span> },
    { key: 'user', header: 'Account', cell: (e) => (e.user ? <span className="whitespace-nowrap">{e.user.name} <span className="text-[13px] text-muted-foreground">({e.user.username})</span></span> : <span className="text-muted-foreground">-</span>) },
    { key: 'status', header: 'Status', cell: (e) => (e.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>) },
    ...(canManage ? [{
      key: 'aksi', header: <span className="sr-only">Actions</span>, className: 'text-right',
      cell: (e: Employee) => <Button size="sm" variant="ghost" className="h-8" onClick={() => { setEditing(e); setFormOpen(true) }}><Pencil className="size-3.5" /> Edit</Button>,
    }] : []),
  ]
  const [hiddenCols, toggleCol] = useHiddenColumns('stockwise:employee-hidden-columns')

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    importEmployees.mutate(file, {
      onSuccess: (result) => {
        toast.success(`Import finished: ${result.created} added, ${result.updated} updated`)
        if (result.errors.length > 0) {
          toast.warning(`${result.errors.length} error: ${result.errors.slice(0, 3).join(', ')}${result.errors.length > 3 ? '...' : ''}`)
        }
      },
      onError: (err) => {
        toast.fromError(err, apiErrorMessage(err))
      },
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Master Data · Employees" icon={<UserRound className="size-5" />}
        subtitle="Company employee data: name, position, division, and STOCKWISE account."
        actions={canManage && <>
          <Button size="sm" variant="outline" onClick={downloadEmployeeTemplate}><Download className="size-4" /> Template</Button>
          <Button size="sm" variant="outline" onClick={() => document.getElementById('employee-import')?.click()} disabled={importEmployees.isPending}>
            <FileUp className="size-4" /> {importEmployees.isPending ? 'Importing...' : 'Import'}
          </Button>
          <input id="employee-import" type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}><Plus className="size-4" /> Add</Button>
        </>} />

      <FilterBar end={<>
        <span className="text-xs text-muted-foreground">{rows.length.toLocaleString('id-ID')} employees</span>
        <ColumnMenu columns={columns} hiddenCols={hiddenCols} onToggle={toggleCol} alwaysVisible={['name', 'aksi']} hint="Select the columns shown in the table." />
      </>}>
        <Input className="w-full sm:max-w-sm" placeholder="Search name, position, WA no., office phone, division…" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <div className="w-full sm:w-52">
          <Select aria-label="Division" value={division} onChange={(e) => setDivision(e.target.value)}>
            <option value="">All divisions</option>
            {(departments ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-40">
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </Select>
        </div>
      </FilterBar>

      <DataTable columns={visibleColumns(columns, hiddenCols, ['name', 'aksi'])} rows={rows} rowKey={(e) => e.id} isLoading={isLoading}
        emptyText={search || division || status ? 'No employees for this filter.' : 'No employee data yet.'} />

      <EmployeeForm open={formOpen} employee={editing} onClose={() => setFormOpen(false)} />
    </div>
  )
}
