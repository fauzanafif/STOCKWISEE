import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, ListChecks, Loader2, Lock, LogIn, LogOut, Send, UserRound } from 'lucide-react'
import { isAxiosError } from 'axios'
import { apiErrorMessage } from '@/lib/api'
import { trackedTokens, usePublicRequestForm, usePublicRequestLogin, useSubmitPublicRequest, type PublicRequester } from '@/features/itemRequests/api'
import { FormExtraFields } from '@/components/itemRequests/FormExtraFields'
import { RequestLinesEditor, emptyLine, filledLines, linesError, toPayloadLines, type DraftLine } from '@/components/itemRequests/RequestLinesEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { invalidTo } from '@/lib/notify'

/** Header of the pages opened without an account (request form, Cek Permintaan). */
export function PublicShell({ children, label, title = 'Item Request', action }: { children: React.ReactNode; label?: string | null; title?: string; action?: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <img src="/logo.png" alt="" className="size-8 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold leading-tight">{title}</span>
            <span className="block truncate text-xs text-muted-foreground">{label || 'PT Surya Inti Gas Warehouse'}</span>
          </span>
          {action}
        </div>
      </header>
      <main className="p-3 sm:p-4">{children}</main>
    </div>
  )
}

/** The small "Permintaan saya" button: the requests sent from this device and their status. */
function MyRequestsLink() {
  const n = trackedTokens().length
  return (
    <Link to="/cek-permintaan" className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted">
      <ListChecks className="size-4 text-primary" /> Check request
      {n > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{n}</span>}
    </Link>
  )
}

function Shell(props: { children: React.ReactNode; label?: string | null; title?: string }) {
  return <PublicShell {...props} action={<MyRequestsLink />} />
}

type Signed = { session: string; profile: PublicRequester; at: number }
/** the sign-in of this tab (3 hours, like the server's session) */
const SIGNED_MS = 3 * 3600_000
const signedKey = (token: string) => `sw.request-form.${token}`
function readSigned(token: string): Signed | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(signedKey(token)) ?? 'null') as Signed | null
    return v && Date.now() - v.at < SIGNED_MS ? v : null
  } catch { return null }
}
function saveSigned(token: string, v: Signed | null) {
  try { if (v) sessionStorage.setItem(signedKey(token), JSON.stringify(v)); else sessionStorage.removeItem(signedKey(token)) } catch { /* private mode */ }
}

/** Step 1 of the form: the STOCKWISE account (username + password) of whoever asks. */
function SignIn({ token, note, onSigned }: { token: string; note?: string | null; onSigned: (v: Signed) => void }) {
  const login = usePublicRequestLogin(token)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const go = (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!username.trim() || !password) return invalidTo(setErr, 'Fill in the username and password.')
    login.mutate({ username: username.trim(), password }, {
      onSuccess: (d) => onSigned({ ...d, at: Date.now() }),
      onError: (e) => setErr(apiErrorMessage(e)),
    })
  }
  return (
    <form onSubmit={go} className="mx-auto w-full max-w-sm space-y-4 rounded-lg border bg-card p-5">
      <div className="space-y-1 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="size-5" /></span>
        <h1 className="text-lg font-semibold tracking-tight">Sign in first</h1>
        <p className="text-sm text-muted-foreground">Use your STOCKWISE account. Requester data fills automatically.</p>
      </div>
      {note && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{note}</p>}
      <div className="space-y-1.5">
        <Label htmlFor="rq-user">Username</Label>
        <Input id="rq-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus placeholder="e.g. aan" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rq-pass">Password</Label>
        <Input id="rq-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </div>
      {err && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
      <Button type="submit" className="w-full" size="lg" disabled={login.isPending}>
        {login.isPending ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />} In
      </Button>
    </form>
  )
}

/**
 * Request Barang opened through a share link (/form/request/:token): no account —
 * the karyawan signs in with their STOCKWISE account first (their data fills the form), then types
 * what they need; admin gudang gets it in STOCKWISE, under that account.
 */
export function PublicItemRequestPage() {
  const { token = '' } = useParams()
  const form = usePublicRequestForm(token)
  const submit = useSubmitPublicRequest(token)
  const [signed, setSigned] = useState<Signed | null>(() => readSigned(token))
  const [signNote, setSignNote] = useState<string | null>(null)
  const [contact, setContact] = useState(() => readSigned(token)?.profile.contact ?? '')
  const [divisi, setDivisi] = useState('')
  const [neededDate, setNeededDate] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [detail, setDetail] = useState('')
  // the form's own divisi (Maintenance General -> MAINTENANCE, …) as a starting point
  const defaultDivisi = form.data?.form.default_divisi
  useEffect(() => { if (defaultDivisi) setDivisi((d) => d || defaultDivisi) }, [defaultDivisi])
  // signed in: the requester's own data fills the form (still editable, except the name)
  const onSigned = (v: Signed) => {
    saveSigned(token, v)
    setSigned(v)
    setSignNote(null)
    setContact(v.profile.contact ?? '')
    if (v.profile.divisi) setDivisi(v.profile.divisi)
  }
  useEffect(() => { const d = readSigned(token)?.profile.divisi; if (d) setDivisi(d) }, [token])
  const signOut = (note: string | null = null) => { saveSigned(token, null); setSigned(null); setSignNote(note); setContact('') }
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()])
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState<{ number: string; track_token: string } | null>(null)

  if (form.isLoading) return <Shell><p className="py-10 text-center text-muted-foreground">Loading…</p></Shell>
  if (form.isError || !form.data) {
    return <Shell><Closed title="Link not found" text="This link was deleted or mistyped. Ask the warehouse admin for the latest link." /></Shell>
  }
  if (!form.data.is_active) {
    return <Shell label={form.data.label} title={form.data.form.label}><Closed title="The request form is closed" text="The warehouse admin has closed this form. Try again later or contact the warehouse admin." /></Shell>
  }

  const f = form.data.form

  if (sent) {
    return (
      <Shell label={form.data.label} title={f.label}>
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-card px-6 py-10 text-center">
          <CheckCircle2 className="size-12 text-emerald-600" />
          <h1 className="text-xl font-semibold tracking-tight">Request sent</h1>
          <p className="text-sm text-muted-foreground">Your request number</p>
          <p className=" text-xl font-semibold">{sent.number}</p>
          <p className="max-w-sm text-sm text-muted-foreground">The warehouse admin will check the items. You can follow the status any time with the button below (saved on this device).</p>
          <div className="flex w-full max-w-xs flex-col gap-2">
            <Button asChild size="lg"><Link to={`/cek-permintaan/${sent.track_token}`}><ListChecks className="size-4" /> Check request status</Link></Button>
            <Button variant="outline" onClick={() => { setSent(null); setLines([emptyLine()]); setNeededDate(''); setDetail('') }}>Send another request</Button>
            <Button variant="ghost" onClick={() => { setSent(null); setLines([emptyLine()]); setNeededDate(''); setDetail(''); signOut() }}><LogOut className="size-4" /> Out</Button>
          </div>
        </div>
      </Shell>
    )
  }

  if (!signed) {
    return (
      <Shell label={form.data.label} title={f.label}>
        <div className="py-4"><SignIn token={token} note={signNote} onSigned={onSigned} /></div>
      </Shell>
    )
  }
  const me = signed.profile

  const send = () => {
    setErr(null)
    const lineErr = linesError(lines)
    if (lineErr) return invalidTo(setErr, lineErr)
    submit.mutate({
      session: signed.session, requester_contact: contact.trim() || null, divisi: divisi.trim() || null,
      form_detail: f.detail_label ? detail.trim() || null : null,
      needed_date: neededDate || null, lines: toPayloadLines(lines), website,
    }, {
      onSuccess: (d) => setSent(d),
      // the sign-in ran out: sign in again, the items typed stay
      onError: (e) => (isAxiosError(e) && e.response?.status === 419 ? signOut('Session expired. Sign in again; the items you filled in stay saved.') : setErr(apiErrorMessage(e))),
    })
  }

  return (
    <Shell label={form.data.label} title={f.label}>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{f.label}</h1>
        </div>
        <ol className="flex gap-2 text-xs text-muted-foreground" aria-label="Steps">
          {['Requester data', 'Item', 'Send'].map((t, i) => (
            <li key={t} className="flex items-center gap-1.5"><span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{i + 1}</span>{t}{i < 2 && <span className="mx-1 text-border">›</span>}</li>
          ))}
        </ol>
        <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2">
          <div className="flex items-center gap-2 sm:col-span-2">
            <span className="flex-1 text-sm font-semibold">Requester data</span>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={() => signOut()}><LogOut className="size-4" /> Not you?</Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rq-name">Name</Label>
            <Input id="rq-name" value={me.name} readOnly className="bg-muted/50" title={`Account: ${me.username}`} />
            {me.position && <p className="text-xs text-muted-foreground">{me.position}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rq-contact">Phone No. / Ext (optional)</Label>
            <Input id="rq-contact" value={contact} maxLength={60} onChange={(e) => setContact(e.target.value)} inputMode="tel" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rq-divisi">Division</Label>
            <Input id="rq-divisi" value={divisi} maxLength={100} onChange={(e) => setDivisi(e.target.value)} placeholder="e.g. Maintenance" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rq-date">Needed by</Label>
            <Input id="rq-date" type="date" value={neededDate} onChange={(e) => setNeededDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <FormExtraFields form={f} detail={detail} onDetail={setDetail} />
          </div>
          {/* honeypot: hidden from people */}
          <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        </div>
        <RequestLinesEditor lines={lines} onChange={setLines} />
        {err && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
        {/* the send button stays in reach while scrolling a long list */}
        <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <Button className="w-full" size="lg" onClick={send} disabled={submit.isPending}>
            {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send request ({filledLines(lines).length} items)
          </Button>
        </div>
      </div>
    </Shell>
  )
}

function Closed({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-card px-6 py-12 text-center">
      <Lock className="size-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
    </div>
  )
}
