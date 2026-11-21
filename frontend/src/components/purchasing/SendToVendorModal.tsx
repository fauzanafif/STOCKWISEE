import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Loader2, Mail, MessageCircle, TriangleAlert } from 'lucide-react'
import { api, apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface Share {
  vendors: { id: number; name: string; email: string | null; phone: string | null }[]
  subject: string
  message: string
  pdf_url: string
  link_days: number
  mail_ready: boolean
  public_base: string
}

/** an address only the office network reaches (a vendor outside cannot open the link) */
const privateBase = (u: string) => /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u)

/**
 * Send a PO to its vendor: by email (the PDF attached) or WhatsApp (a message with a signed link to the PDF,
 * valid for some days, that opens without logging in). An approved PO becomes Sent; every sending is in its Audit.
 */
export function SendToVendorModal({ poId, number, onClose }: { poId: number; number: string; onClose: () => void }) {
  const qc = useQueryClient()
  const share = useQuery({ queryKey: ['po', poId, 'vendor-share'], queryFn: async () => (await api.get<{ data: Share }>(`/api/purchase-orders/${poId}/vendor-share`)).data.data })
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp')
  const [vendorId, setVendorId] = useState<number | ''>('')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [save, setSave] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const s = share.data
  const vendor = s?.vendors.find((v) => v.id === vendorId)

  // the form starts from the PO's (first) vendor and its saved contact
  useEffect(() => {
    if (!s) return
    setVendorId((v) => v || s.vendors[0]?.id || '')
    setSubject(s.subject)
    setMessage(s.message)
  }, [s])
  useEffect(() => {
    setTo((channel === 'email' ? vendor?.email : vendor?.phone) ?? '')
    if (vendor && s) setMessage(s.message.replace(/^Yth\. [^,]*,/, `Yth. ${vendor.name},`))
  }, [channel, vendorId]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: async () => (await api.post<{ data: { whatsapp_url: string | null; emailed: boolean } }>(`/api/purchase-orders/${poId}/send-to-vendor`, {
      channel, vendor_id: vendorId || null, to, subject: channel === 'email' ? subject : null, message, save_contact: save,
    })).data.data,
  })
  const saved = channel === 'email' ? vendor?.email : vendor?.phone
  const submit = () => {
    setErr(null)
    if (!to.trim()) return setErr(channel === 'email' ? 'Fill in the vendor email.' : 'Fill in the vendor WhatsApp number.')
    // a window opened now (not after the answer) is not stopped by the browser's popup blocker
    const win = channel === 'whatsapp' ? window.open('about:blank', '_blank') : null
    send.mutate(undefined, {
      onSuccess: (r) => {
        if (r.whatsapp_url) { if (win) win.location.href = r.whatsapp_url; else window.open(r.whatsapp_url, '_blank') }
        toast.success(r.emailed ? `${number} emailed to ${to}.` : `WhatsApp opened for ${number}.`)
        void qc.invalidateQueries({ queryKey: ['po'] })
        void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
        onClose()
      },
      onError: (e) => { win?.close(); setErr(apiErrorMessage(e)) },
    })
  }
  const copy = async () => {
    if (!s) return
    try { await navigator.clipboard.writeText(s.pdf_url); toast.success('PDF link copied.') } catch { toast.error('Could not copy: select the link and copy it.') }
  }

  return (
    <Modal open onClose={onClose} title={`Send ${number} to vendor`} className="max-w-lg"
      footer={<>
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={send.isPending || !s || (channel === 'email' && !s.mail_ready)} onClick={submit}>
          {send.isPending ? <Loader2 className="size-4 animate-spin" /> : channel === 'email' ? <Mail className="size-4" /> : <MessageCircle className="size-4" />}
          {channel === 'email' ? 'Send email' : 'Open WhatsApp'}
        </Button>
      </>}>
      {share.isLoading || !s ? <div className="flex h-32 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : (
        <div className="space-y-4">
          <div role="tablist" aria-label="Send by" className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1">
            {([['whatsapp', 'WhatsApp', MessageCircle], ['email', 'Email', Mail]] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" role="tab" aria-selected={channel === k} onClick={() => setChannel(k)}
                className={cn('flex h-9 items-center justify-center gap-1.5 rounded-md text-sm font-medium', channel === k ? 'bg-card shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground')}>
                <Icon className="size-4" />{label}
              </button>
            ))}
          </div>

          {channel === 'email' && !s.mail_ready && (
            <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              The server has no email account yet (SMTP), so an email cannot leave it. Use WhatsApp for now, or ask the admin to set MAIL_* in the server's .env.
            </p>
          )}

          {s.vendors.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="stv-vendor">Vendor</Label>
              <Select id="stv-vendor" value={vendorId} onChange={(e) => setVendorId(Number(e.target.value) || '')}>
                {s.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="stv-to">{channel === 'email' ? 'Vendor email' : 'Vendor WhatsApp number'}{s.vendors.length === 1 && vendor ? ` · ${vendor.name}` : ''}</Label>
            <Input id="stv-to" type={channel === 'email' ? 'email' : 'tel'} inputMode={channel === 'email' ? 'email' : 'tel'} value={to} onChange={(e) => setTo(e.target.value)}
              placeholder={channel === 'email' ? 'sales@vendor.co.id' : '0812 3456 7890'} />
            {vendor && to.trim() && to.trim() !== (saved ?? '') && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" className="size-3.5 accent-primary" checked={save} onChange={(e) => setSave(e.target.checked)} />
                Save to {vendor.name} for the next time
              </label>
            )}
          </div>
          {channel === 'email' && (
            <div className="space-y-1.5"><Label htmlFor="stv-subject">Subject</Label><Input id="stv-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} /></div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="stv-msg">Message</Label>
            <Textarea id="stv-msg" rows={7} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />
            <p className="text-xs text-muted-foreground">{channel === 'email' ? 'The PO PDF is attached.' : `The message carries a link to the PO PDF, valid ${s.link_days} days.`}</p>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={s.pdf_url}>{s.pdf_url}</span>
            <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2" onClick={() => void copy()}><Copy className="size-3.5" /> Copy link</Button>
          </div>
          {privateBase(s.public_base) && (
            <p className="text-xs text-amber-700">The link starts with the office address ({s.public_base}): it opens only inside the office network until STOCKWISE_SHARE_URL is a public address.</p>
          )}
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </div>
      )}
    </Modal>
  )
}
