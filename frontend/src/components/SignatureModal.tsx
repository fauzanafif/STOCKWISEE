import { useEffect, useRef, useState } from 'react'
import { Eraser, Loader2, PenLine, Trash2, Upload } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { api, apiErrorMessage } from '@/lib/api'
import { toast } from '@/lib/notify'
import type { AuthUser } from '@/types'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { confirmDialog } from '@/components/ui/confirm'

const W = 640
const H = 220

/** The user's e-sign image, or nothing when there is none. */
export function SignaturePreview({ user, className = 'h-20' }: { user?: Pick<AuthUser, 'signature_url'> | null; className?: string }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [user?.signature_url])
  return user?.signature_url && !broken
    ? <img src={user.signature_url} alt="Signature" className={`${className} max-w-full object-contain`} />
    : null
}

/**
 * E-sign, kept simple: the current signature (or "Belum ada e-sign"),
 * and two buttons — Buat (draw on a pad) or Upload (an image file).
 */
export function SignatureModal({ onClose }: { onClose: () => void }) {
  const { user, setCurrentUser } = useAuth()
  const fileInput = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [mode, setMode] = useState<'idle' | 'draw' | 'upload'>('idle')
  const [picked, setPicked] = useState<string | null>(null)
  const [hasInk, setHasInk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const pick = (file?: File) => {
    setErr(null)
    if (!file) return
    if (!file.type.startsWith('image/')) return setErr('Pilih file gambar (JPG, PNG, WEBP).')
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = W; c.height = H
      const g = c.getContext('2d')!
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
      const s = Math.min(W / img.naturalWidth, H / img.naturalHeight)
      const w = img.naturalWidth * s; const h = img.naturalHeight * s
      g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
      setPicked(c.toDataURL('image/png'))
      setHasInk(false)
      URL.revokeObjectURL(url)
    }
    img.onerror = () => { setErr('Gambar tidak bisa dibaca. Coba file lain.'); URL.revokeObjectURL(url) }
    img.src = url
  }

  // white pad each time drawing opens
  useEffect(() => {
    if (mode !== 'draw') return
    const g = canvasRef.current?.getContext('2d')
    if (!g) return
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
    g.strokeStyle = '#111'; g.lineWidth = 2.5; g.lineCap = 'round'; g.lineJoin = 'round'
  }, [mode])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = canvasRef.current?.getContext('2d')
    if (!g) return
    drawing.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = pos(e)
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.1, y + 0.1); g.stroke()
    setHasInk(true)
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const g = canvasRef.current?.getContext('2d')
    if (!g) return
    const { x, y } = pos(e)
    g.lineTo(x, y); g.stroke()
  }
  const up = () => { drawing.current = false }
  const clearPad = () => {
    const c = canvasRef.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
    setHasInk(false)
  }

  const image = mode === 'draw' && hasInk ? canvasRef.current?.toDataURL('image/png') ?? null : picked

  const save = async () => {
    if (!image) return
    setBusy(true); setErr(null)
    try {
      const { data } = await api.post<{ user: AuthUser }>('/api/me/signature', { image })
      setCurrentUser?.(data.user)
      toast.success('E-sign tersimpan.')
      onClose()
    } catch (e) { setErr(apiErrorMessage(e)) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!(await confirmDialog({ message: 'Hapus e-sign?', danger: true }))) return
    setBusy(true); setErr(null)
    try {
      const { data } = await api.delete<{ user: AuthUser }>('/api/me/signature')
      setCurrentUser?.(data.user)
      toast.success('E-sign dihapus.')
      onClose()
    } catch (e) { setErr(apiErrorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="E-Sign" className="max-w-lg"
      footer={<>
        {user?.signature_url && mode === 'idle' && <Button variant="ghost" size="sm" className="mr-auto text-destructive hover:bg-destructive/10" disabled={busy} onClick={remove}><Trash2 className="size-4" /> Hapus</Button>}
        <Button variant="outline" size="sm" onClick={onClose}>Batal</Button>
        <Button size="sm" disabled={!image || busy} onClick={save}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Simpan</Button>
      </>}>
      <div className="flex flex-col items-center gap-4 py-2">
        {/* current signature */}
        <div className="flex h-28 w-full items-center justify-center rounded-md border bg-white p-3">
          {picked
            ? <img src={picked} alt="E-sign baru" className="max-h-24 w-full object-contain" />
            : mode === 'idle' && user?.signature_url
              ? <SignaturePreview user={user} className="max-h-24 w-full" />
              : <span className="text-sm text-muted-foreground">Belum ada e-sign.</span>}
        </div>

        {/* create / upload */}
        {mode === 'idle' && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setMode('draw'); setPicked(null) }}><PenLine className="size-4" /> Buat</Button>
            <Button variant="outline" onClick={() => { setMode('upload'); setPicked(null) }}><Upload className="size-4" /> Upload</Button>
          </div>
        )}

        {mode === 'draw' && (
          <div className="flex w-full flex-col gap-2">
            <canvas ref={canvasRef} width={W} height={H}
              className="w-full touch-none rounded-md border bg-white"
              style={{ aspectRatio: `${W}/${H}` }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setMode('idle')} disabled={busy}>Kembali</Button>
              <Button variant="ghost" size="sm" onClick={clearPad} disabled={!hasInk}><Eraser className="size-4" /> Bersihkan</Button>
            </div>
          </div>
        )}

        {mode === 'upload' && (
          <div className="flex w-full flex-col items-center gap-3 rounded-md border border-dashed p-6">
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
            {picked
              ? <img src={picked} alt="Signature baru" className="max-h-40 rounded-md border bg-white object-contain" />
              : <p className="text-sm text-muted-foreground">Pilih gambar tanda tangan.</p>}
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setMode('idle')} disabled={busy}>Kembali</Button>
              <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}><Upload className="size-4" /> Pilih gambar</Button>
            </div>
          </div>
        )}

        {err && <p className="text-sm text-destructive">{err}</p>}
      </div>
    </Modal>
  )
}
