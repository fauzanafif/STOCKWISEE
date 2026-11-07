import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Camera, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** The QR text in an image (a photo of the representative's phone screen), or null. */
async function readQr(file: File): Promise<string | null> {
  const bmp = await createImageBitmap(file)
  // try a few sizes: a big photo decodes faster and better scaled down
  for (const max of [1000, 1600, 640]) {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, c.width, c.height)
    const img = ctx.getImageData(0, 0, c.width, c.height)
    const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
    if (hit?.data) return hit.data
  }
  return null
}

/**
 * Reads a QR code: the live camera where the browser allows it (HTTPS / localhost), otherwise a photo
 * of the QR taken with the phone camera (works on the LAN address over http too). Calls onResult once.
 */
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const live = typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
  const [state, setState] = useState<'starting' | 'on' | 'photo'>(live ? 'starting' : 'photo')
  const [reading, setReading] = useState(false)
  const [miss, setMiss] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    if (!live) return
    let stream: MediaStream | null = null
    let raf = 0
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const tick = () => {
      const v = video.current
      if (v && ctx && v.readyState === v.HAVE_ENOUGH_DATA && !done.current) {
        const scale = Math.min(1, 640 / v.videoWidth)
        canvas.width = Math.round(v.videoWidth * scale)
        canvas.height = Math.round(v.videoHeight * scale)
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
        if (hit?.data) {
          done.current = true
          navigator.vibrate?.(80)
          onResult(hit.data)
          return
        }
      }
      raf = requestAnimationFrame(tick)
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        stream = s
        if (!video.current) return
        video.current.srcObject = s
        void video.current.play()
        setState('on')
        raf = requestAnimationFrame(tick)
      })
      .catch(() => setState('photo'))
    return () => { cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()) }
  }, [live, onResult])

  const pick = async (f?: File) => {
    if (!f) return
    setReading(true)
    setMiss(false)
    try {
      const text = await readQr(f)
      if (text) { navigator.vibrate?.(80); onResult(text) } else setMiss(true)
    } catch { setMiss(true) } finally { setReading(false) }
  }

  if (state === 'photo') {
    return (
      <div className="space-y-2">
        <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
        <Button type="button" variant="outline" className="h-auto w-full flex-col gap-1.5 border-2 border-dashed py-6" disabled={reading} onClick={() => file.current?.click()}>
          {reading ? <Loader2 className="size-7 animate-spin" /> : <Camera className="size-7" />}
          <span className="font-medium">{reading ? 'Reading QR…' : 'Representative QR photo'}</span>
          <span className="text-xs font-normal text-muted-foreground">Point the camera at the QR on the representative phone, then capture</span>
        </Button>
        {miss && <p className="text-xs text-destructive">The QR cannot be read. Photograph it closer without glare, or type the code.</p>}
      </div>
    )
  }
  return (
    <div className="relative overflow-hidden rounded-lg border bg-black">
      <video ref={video} playsInline muted className="aspect-square w-full object-cover" />
      {state === 'on'
        ? <div className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
        : <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/90"><Loader2 className="size-5 animate-spin" /> Opening camera…</div>}
    </div>
  )
}
