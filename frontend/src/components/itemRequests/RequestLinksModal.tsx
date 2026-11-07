import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, Download, Link2, Loader2, QrCode, Trash2 } from 'lucide-react'
import { apiErrorMessage } from '@/lib/api'
import { requestFormUrl, useItemRequestLinkMutations, useItemRequestLinks, useRequestForms, useShareBase, type FormType, type ItemRequestLink } from '@/features/itemRequests/api'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { confirmDialog } from '@/components/ui/confirm'


const when = (d: string | null) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never')

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const t = document.createElement('textarea')
    t.value = text
    document.body.appendChild(t)
    t.select()
    const ok = document.execCommand('copy')
    t.remove()
    return ok
  }
}

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60', on ? 'bg-emerald-500' : 'bg-muted-foreground/30')}>
      <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  )
}

/** A printable QR card of a link: the form's name, the QR (opens the form) and the address under it. */
async function qrCard(url: string, title: string, sub: string | null): Promise<string> {
  const qr = await QRCode.toDataURL(url, { width: 720, margin: 1, errorCorrectionLevel: 'M' })
  const img = new Image()
  await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = qr })
  const W = 900, H = 1180
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
  g.fillStyle = '#0f172a'; g.textAlign = 'center'
  g.font = 'bold 52px Arial, sans-serif'; g.fillText(title, W / 2, 110)
  g.font = '30px Arial, sans-serif'; g.fillStyle = '#475569'
  g.fillText(sub || 'Scan to open the request form', W / 2, 165)
  g.drawImage(img, (W - 720) / 2, 210, 720, 720)
  g.font = '26px Arial, sans-serif'; g.fillStyle = '#334155'
  g.fillText('Sign in with your STOCKWISE account', W / 2, 990)
  g.font = '22px monospace'; g.fillStyle = '#64748b'
  const short = url.length > 60 ? url.slice(0, 57) + '…' : url
  g.fillText(short, W / 2, 1040)
  g.font = 'bold 26px Arial, sans-serif'; g.fillStyle = '#1d4ed8'; g.fillText('STOCKWISE · PT Surya Inti Gas', W / 2, 1110)
  return c.toDataURL('image/png')
}

function LinkQr({ url, link }: { url: string; link: ItemRequestLink }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(url, { width: 320, margin: 1, errorCorrectionLevel: 'M' }).then((d) => alive && setSrc(d)).catch(() => alive && setSrc(null))
    return () => { alive = false }
  }, [url])
  const download = async () => {
    const a = document.createElement('a')
    a.href = await qrCard(url, link.form_label, link.label)
    a.download = `qr-${link.form_label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${link.label ? '-' + link.label.toLowerCase().replace(/[^a-z0-9]+/g, '-') : ''}.png`
    document.body.appendChild(a); a.click(); a.remove()
  }
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/30 p-3">
      <div className="rounded-md bg-white p-2">{src ? <img src={src} alt={`QR ${link.form_label}`} className="size-36" /> : <div className="flex size-36 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}</div>
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        {!link.is_active && <p className="text-xs text-amber-700">The link is off: the QR still points to the form, but the form is closed.</p>}
        <Button size="sm" onClick={download}><Download className="size-4" /> Download QR</Button>
      </div>
    </div>
  )
}

function LinkRow({ link }: { link: ItemRequestLink }) {
  const [showQr, setShowQr] = useState(false)
  const m = useItemRequestLinkMutations()
  const [copied, setCopied] = useState(false)
  const { base } = useShareBase()
  const url = requestFormUrl(link.token, base)
  const toggling = m.update.isPending && m.update.variables?.id === link.id
  return (
    <li className="space-y-2 py-3">
      <div className="flex items-center gap-3">
        <Switch on={link.is_active} disabled={toggling} label={link.is_active ? 'Turn off link' : 'Turn on link'}
          onChange={(v) => m.update.mutate({ id: link.id, is_active: v })} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {link.form_label}{link.label ? <span className="font-normal text-muted-foreground"> · {link.label}</span> : null}{' '}
            <span className={cn('ml-1 rounded-full px-2 py-0.5 text-xs', link.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground')}>
              {link.is_active ? 'Active' : 'Off'}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">{link.requests_count} request · last used {when(link.last_used_at)}</div>
        </div>
        <button type="button" className="rounded p-2 text-muted-foreground hover:text-destructive" aria-label="Delete link"
          onClick={async () => { if ((await confirmDialog('Delete this link? The old link will no longer open (requests already in stay).'))) m.remove.mutate(link.id) }}>
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <Input readOnly value={url} className={cn('h-10 min-w-0 flex-1 text-[13px]', !link.is_active && 'opacity-60')} onFocus={(e) => e.target.select()} />
        <Button variant={copied ? 'outline' : 'default'} className="h-10 shrink-0" onClick={async () => { if (await copy(url)) { setCopied(true); setTimeout(() => setCopied(false), 2000) } }}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="outline" className="h-10 shrink-0" aria-expanded={showQr} onClick={() => setShowQr((v) => !v)}><QrCode className="size-4" /> QR</Button>
      </div>
      {showQr && <LinkQr url={url} link={link} />}
    </li>
  )
}

/** Share the Request Barang form by link: karyawan send requests without an account; admin turns each link on / off. */
export function RequestLinksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const share = useShareBase()
  const links = useItemRequestLinks(open)
  const m = useItemRequestLinkMutations()
  const forms = useRequestForms()
  const [label, setLabel] = useState('')
  const [formType, setFormType] = useState<FormType>('ATK')
  const [err, setErr] = useState<string | null>(null)

  const create = () => {
    setErr(null)
    m.create.mutate({ label: label.trim() || null, form_type: formType }, {
      onSuccess: (l) => { setLabel(''); void copy(requestFormUrl(l.token, share.base)) },
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={<span className="inline-flex items-center gap-2"><Link2 className="size-4" />Request form link</span>}
      description={<>Link <b>active</b> opens the request form; the sender signs in with their STOCKWISE account and the data fills automatically. Share the link or QR. Turn the link off to close the form.</>}>
      <div className="space-y-4">
        {share.localOnly && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
            STOCKWISE is opened through <b>{window.location.host}</b>, so the link below only opens on this computer. Open STOCKWISE through the office network address (LAN) and copy the link from there.
          </p>
        )}
        <p className="text-xs text-muted-foreground">Link opened through the office network: <span className="">{share.base}</span></p>
        <div className="space-y-2 rounded-lg border p-3">
          <div className="text-sm font-medium">New link</div>
          <Select className="h-10" aria-label="Form type" value={formType} onChange={(e) => setFormType(e.target.value as FormType)}>
            {(forms.data ?? []).filter((f) => f.type !== 'UMUM').map((f) => <option key={f.type} value={f.type}>{f.label}</option>)}
            <option value="UMUM">General Request</option>
          </Select>
          <div className="flex gap-2">
            <Input className="h-10 min-w-0 flex-1" placeholder="Link label (optional), e.g. Warehouse WA group" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} />
            <Button className="h-10 shrink-0" onClick={create} disabled={m.create.isPending}>
              {m.create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} Create link
            </Button>
          </div>
          {m.create.isSuccess && <p className="text-xs text-emerald-600">Link created and copied; just paste it into WhatsApp. Its QR is under the QR button in the link list.</p>}
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <div>
          <div className="text-sm font-medium">Link list</div>
          {links.isLoading ? <p className="py-3 text-sm text-muted-foreground">Loading…</p>
            : (links.data ?? []).length === 0 ? <p className="py-3 text-sm text-muted-foreground">No links yet.</p>
              : <ul className="divide-y">{links.data!.map((l) => <LinkRow key={l.id} link={l} />)}</ul>}
        </div>
      </div>
    </Modal>
  )
}
