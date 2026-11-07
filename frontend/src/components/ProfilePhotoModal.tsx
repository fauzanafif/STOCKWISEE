import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { api, apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/notify'
import type { AuthUser } from '@/types'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { confirmDialog } from '@/components/ui/confirm'

function initials(name?: string) {
  return (name ?? '?').split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
}

/** The user's photo, or their initials. */
export function UserAvatar({ user, className = 'size-9 text-sm' }: { user?: Pick<AuthUser, 'name' | 'avatar_url'> | null; className?: string }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [user?.avatar_url])
  return user?.avatar_url && !broken
    ? <img src={user.avatar_url} alt="" onError={() => setBroken(true)} className={`${className} shrink-0 rounded-full object-cover`} />
    : <span className={`${className} flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary`}>{initials(user?.name)}</span>
}

/** A picked photo, cropped to a square and made small before it is sent (the server makes it 256px). */
async function squareJpeg(file: File, size = 512): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = url })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const c = document.createElement('canvas')
    c.width = size; c.height = size
    const g = c.getContext('2d')!
    g.fillStyle = '#fff'; g.fillRect(0, 0, size, size)
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
    return c.toDataURL('image/jpeg', 0.9)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Foto profil: pick a new photo (preview first), save it, or remove it. */
export function ProfilePhotoModal({ onClose }: { onClose: () => void }) {
  const { user, setCurrentUser } = useAuth()
  const input = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const pick = async (file?: File) => {
    setErr(null)
    if (!file) return
    if (!file.type.startsWith('image/')) return setErr('Select an image file (JPG, PNG, WEBP).')
    try { setPicked(await squareJpeg(file)) } catch { setErr('The image cannot be read. Try another file.') }
  }
  const save = async () => {
    if (!picked) return
    setBusy(true); setErr(null)
    try {
      const { data } = await api.post<{ user: AuthUser }>('/api/me/avatar', { image: picked })
      setCurrentUser?.(data.user)
      toast.success('Profile photo updated.')
      onClose()
    } catch (e) { setErr(apiErrorMessage(e)) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!(await confirmDialog({ message: 'Delete the profile photo?', danger: true }))) return
    setBusy(true); setErr(null)
    try {
      const { data } = await api.delete<{ user: AuthUser }>('/api/me/avatar')
      setCurrentUser?.(data.user)
      toast.success('Profile photo removed.')
      onClose()
    } catch (e) { setErr(apiErrorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="Profile Photo" className="max-w-sm"
      footer={<>
        {user?.avatar_url && !picked && <Button variant="ghost" size="sm" className="mr-auto text-destructive hover:bg-destructive/10" disabled={busy} onClick={remove}><Trash2 className="size-4" /> Delete photo</Button>}
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" disabled={!picked || busy} onClick={save}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Save</Button>
      </>}>
      <div className="flex flex-col items-center gap-4 py-2">
        {picked
          ? <img src={picked} alt="New photo" className="size-40 rounded-full object-cover ring-4 ring-primary/15" />
          : <UserAvatar user={user} className="size-40 text-4xl" />}
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
        <Button variant="outline" onClick={() => input.current?.click()} disabled={busy}><Camera className="size-4" /> {picked || user?.avatar_url ? 'Select another photo' : 'Select photo'}</Button>
        <p className="text-center text-xs text-muted-foreground">The photo is cropped square at the center.</p>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}
