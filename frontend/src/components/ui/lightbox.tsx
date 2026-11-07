import { useEffect, useState, useSyncExternalStore } from 'react'
import { ChevronLeft, ChevronRight, Download, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** One picture of the popup: its address, or a loader that fetches it (with the session) when shown. */
export type LightboxImage = { src?: string; load?: () => Promise<string>; alt?: string; name?: string }

let state: { images: LightboxImage[]; index: number } | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Show pictures in a popup over the page (instead of a blob: tab). */
export function openImage(images: LightboxImage | LightboxImage[], index = 0) {
  state = { images: Array.isArray(images) ? images : [images], index }
  emit()
}
const close = () => { state = null; emit() }

/** True when a fetched file is a picture (a PDF still opens on its own). */
export const isImageBlob = (b: Blob | null | undefined) => !!b && b.type.startsWith('image/')

/** A fetched file: a picture opens in the popup; a PDF / video in a new tab as before. */
export function showBlob(blob: Blob, opts: { alt?: string; name?: string } = {}) {
  const url = URL.createObjectURL(blob)
  if (isImageBlob(blob)) { openImage({ src: url, ...opts }); return }
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noreferrer'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** An object URL already in hand (blob:): the same rule, by its type. */
export async function showUrl(url: string | undefined, opts: { alt?: string; name?: string } = {}) {
  if (!url) return
  const blob = await (await fetch(url)).blob()
  if (isImageBlob(blob)) openImage({ src: url, ...opts })
  else window.open(url, '_blank', 'noreferrer')
}

/**
 * The picture popup, mounted once (App): dark backdrop, the picture fitted to the screen (click to
 * see it at full size), arrows when there are more, download, close on ×, Esc or a click outside.
 */
export function LightboxHost() {
  const s = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => state)
  const [src, setSrc] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  const img = s?.images[s.index]
  const many = (s?.images.length ?? 0) > 1
  const go = (by: number) => { if (s) { state = { ...s, index: (s.index + by + s.images.length) % s.images.length }; emit() } }

  // the picture of this step (loaded when needed)
  useEffect(() => {
    setZoom(false)
    setSrc(img?.src ?? null)
    if (!img || img.src || !img.load) return
    let live = true
    img.load().then((u) => { if (live) setSrc(u) }).catch(() => { if (live) setSrc('') })
    return () => { live = false }
  }, [img])

  useEffect(() => {
    if (!s) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight' && many) go(1)
      else if (e.key === 'ArrowLeft' && many) go(-1)
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow }
  }, [s, many]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!s || !img) return null
  const name = img.name ?? img.alt ?? 'gambar'
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/85 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={img.alt ?? 'Image'} onClick={close}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate text-sm">{img.alt ?? ''}{many && <span className="ml-2 text-white/60">{s.index + 1} / {s.images.length}</span>}</span>
        <div className="flex shrink-0 items-center gap-1">
          {src && <a href={src} download={name} className="rounded-full p-2 hover:bg-white/15" aria-label="Download image" title="Download"><Download className="size-5" /></a>}
          <button type="button" onClick={close} className="rounded-full p-2 hover:bg-white/15" aria-label="Close" title="Close (Esc)"><X className="size-6" /></button>
        </div>
      </div>
      <div className={cn('relative flex min-h-0 flex-1 items-center justify-center px-2 pb-6 sm:px-16', zoom && 'items-start overflow-auto')}>
        {src === null && <Loader2 className="size-8 animate-spin text-white/70" />}
        {src === '' && <p className="text-sm text-white/80">The image cannot be loaded.</p>}
        {src && (
          <img src={src} alt={img.alt ?? ''} onClick={(e) => { e.stopPropagation(); setZoom((z) => !z) }}
            className={cn('rounded-lg shadow-2xl', zoom ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain')} />
        )}
        {many && <>
          <button type="button" onClick={(e) => { e.stopPropagation(); go(-1) }} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/25 sm:left-4" aria-label="Previous image"><ChevronLeft className="size-6" /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); go(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/25 sm:right-4" aria-label="Next image"><ChevronRight className="size-6" /></button>
        </>}
      </div>
    </div>
  )
}
