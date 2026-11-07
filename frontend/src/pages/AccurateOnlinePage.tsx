import { useState } from 'react'
import { ChevronDown, ChevronRight, Monitor, Pencil, PlugZap, RefreshCw, Unplug, Wifi } from 'lucide-react'
import {
  useAccurateSessions,
  useRefreshAccurateSessions,
  useSaveAccurateIpLabel,
  useTerminateAccurateSession,
  type AccurateClient,
} from '@/features/accurate/api'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'

function fmtTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('en-GB') : '—'
}

function duration(iso: string | null) {
  if (!iso) return '—'
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} h ${min % 60} min`
}

/** "Budi · Gudang (GUDANG-PC1 · 192.168.2.15)" — who uses the PC first, then what the network reports. */
function clientLabel(c: AccurateClient) {
  const net = c.hostname ? `${c.hostname} · ${c.ip}` : c.ip
  const who = [c.user_name, c.division].filter(Boolean).join(' · ')
  return who ? `${who} (${net})` : net
}

/** Edit user name / division / note of a PC — saved per IP in the STOCKWISE database. */
function EditPcModal({ client, onClose }: { client: AccurateClient; onClose: () => void }) {
  const save = useSaveAccurateIpLabel()
  const [userName, setUserName] = useState(client.user_name ?? '')
  const [division, setDivision] = useState(client.division ?? '')
  const [note, setNote] = useState(client.note ?? '')
  const [err, setErr] = useState<string | null>(null)
  const submit = () =>
    save.mutate(
      { ip: client.ip, user_name: userName.trim(), division: division.trim(), note: note.trim() },
      { onSuccess: onClose, onError: (e) => setErr(apiErrorMessage(e)) },
    )

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit PC data"
      description={`${client.hostname ? `${client.hostname} · ` : ''}${client.ip} — saved per IP, shows again whenever this PC is online.`}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={save.isPending} onClick={submit}>Save</Button>
        </>
      }
    >
      <form className="space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <div className="space-y-1">
          <Label htmlFor="pc-user">User Name</Label>
          <Input id="pc-user" autoFocus maxLength={100} placeholder="e.g. Budi" value={userName} onChange={(e) => setUserName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pc-division">Division</Label>
          <Input id="pc-division" maxLength={100} placeholder="e.g. Warehouse" value={division} onChange={(e) => setDivision(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pc-note">Remarks</Label>
          <Input id="pc-note" maxLength={200} placeholder="e.g. 2nd floor PC" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err && <p className="whitespace-pre-line text-destructive">{err}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

interface Target {
  client: AccurateClient
  remotePort?: number
}

function TerminateModal({ target, onClose }: { target: Target; onClose: () => void }) {
  const terminate = useTerminateAccurateSession()
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const { client, remotePort } = target
  const label = clientLabel(client)

  return (
    <Modal
      open
      onClose={onClose}
      title="Disconnect from Accurate?"
      description={remotePort ? `One connection from ${label}, port ${remotePort}.` : `All database connections (${client.db_connections}) from ${label}.`}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={terminate.isPending}
            onClick={() =>
              terminate.mutate(
                { remote_address: client.ip, remote_port: remotePort, reason: reason.trim() || undefined },
                { onSuccess: onClose, onError: (e) => setErr(apiErrorMessage(e)) },
              )
            }
          >
            <Unplug className="size-4" /> Disconnect
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="rounded-md bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">
          Accurate on that PC will show a "connection lost" error. Work <b>not yet saved</b> on that PC will be lost; data <b>already saved stays safe</b>. The user can open Accurate again right away.
        </div>
        <div className="space-y-1">
          <Label htmlFor="t-reason">Reason (optional, logged)</Label>
          <Input id="t-reason" placeholder="e.g. Accurate hung / PC left open" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {err && <p className="whitespace-pre-line text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}

function ClientRow({ c, canTerminate, canEdit, onTerminate, onEdit }: {
  c: AccurateClient
  canTerminate: boolean
  canEdit: boolean
  onTerminate: (t: Target) => void
  onEdit: (c: AccurateClient) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <tr className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setOpen((v) => !v)}>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            <Monitor className="size-4 text-muted-foreground" />
            <div>
              <div className="font-medium">{c.hostname ?? <span className="text-muted-foreground">(unknown name)</span>}</div>
              <div className="text-[13px] text-muted-foreground">{c.ip}</div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2">{c.user_name ?? <span className="text-muted-foreground">—</span>}</td>
        <td className="px-3 py-2">{c.division ?? <span className="text-muted-foreground">—</span>}</td>
        <td className="px-3 py-2 text-xs">{c.note ?? <span className="text-muted-foreground">—</span>}</td>
        <td className="px-3 py-2 text-[13px]">{c.mac ?? '—'}</td>
        <td className="px-3 py-2">
          {c.status === 'using_database' ? <Badge variant="success">Using Accurate</Badge> : <Badge variant="neutral">Accurate open (license)</Badge>}
        </td>
        <td className="px-3 py-2 text-xs">
          {fmtTime(c.since)}
          <div className="text-muted-foreground">{duration(c.since)}</div>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-end gap-2">
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => onEdit(c)}>
                <Pencil className="size-4" /> Edit
              </Button>
            )}
            {canTerminate && c.db_connections > 0 && (
              <Button size="sm" variant="outline" onClick={() => onTerminate({ client: c })}>
                <Unplug className="size-4" /> Disconnect
              </Button>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="border-t bg-muted/20">
          <td colSpan={8} className="px-3 py-2">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Type</th>
                  <th className="py-1 pr-3 font-medium">Port server</th>
                  <th className="py-1 pr-3 font-medium">Port PC</th>
                  <th className="py-1 pr-3 font-medium">Connected since</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {c.connections.map((k) => (
                  <tr key={`${k.local_port}-${k.remote_port}`} className="border-t border-border/50">
                    <td className="py-1 pr-3">{k.kind === 'database' ? 'Accurate Database' : 'Accurate License'}</td>
                    <td className="py-1 pr-3">{k.local_port}</td>
                    <td className="py-1 pr-3">{k.remote_port}</td>
                    <td className="py-1 pr-3">{fmtTime(k.since)} · {duration(k.since)}</td>
                    <td className="py-1 text-right">
                      {canTerminate && k.kind === 'database' && (
                        <button className="text-destructive hover:underline" onClick={() => onTerminate({ client: c, remotePort: k.remote_port })}>
                          end this connection
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}

export function AccurateOnlinePage() {
  const { hasPermission } = useAuth()
  const canTerminate = hasPermission('accurate.session.terminate')
  const { data, isLoading, error } = useAccurateSessions()
  const refresh = useRefreshAccurateSessions()
  const [target, setTarget] = useState<Target | null>(null)
  const [editing, setEditing] = useState<AccurateClient | null>(null)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Accurate Online"
        subtitle="Computers with Accurate open now"
        icon={<Wifi className="size-5" />}
        actions={
          <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw className={`size-4 ${refresh.isPending ? 'animate-spin' : ''}`} /> Reload
          </Button>
        }
      />

      {error && <p className="text-sm text-destructive">{apiErrorMessage(error)}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">PCs using Accurate</div>
          <div className="text-2xl font-semibold tabular-nums">{data?.summary.clients_using_database ?? '—'}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Total PCs detected (including license only)</div>
          <div className="text-2xl font-semibold tabular-nums">{data?.summary.clients ?? '—'}</div>
        </CardContent></Card>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/60 text-left">
            <tr>
              <th className="px-3 py-2">PC</th>
              <th className="px-3 py-2">User Name</th>
              <th className="px-3 py-2">Division</th>
              <th className="px-3 py-2">Remarks</th>
              <th className="px-3 py-2">MAC</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Connected since</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {data && data.clients.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                <PlugZap className="mx-auto mb-1 size-5" /> No PC is connected to Accurate right now.
              </td></tr>
            )}
            {data?.clients.map((c) => <ClientRow key={c.ip} c={c} canTerminate={canTerminate} canEdit={canTerminate} onTerminate={setTarget} onEdit={setEditing} />)}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Updated {data ? new Date(data.generated_at).toLocaleTimeString('en-GB') : '-'}
      </p>

      {target && <TerminateModal target={target} onClose={() => setTarget(null)} />}
      {editing && <EditPcModal client={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
