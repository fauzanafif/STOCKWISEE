import { useRef, useState } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { photoToDataUrl } from '@/components/tracking/EvidencePhoto'
import { openImage } from '@/components/ui/lightbox'
import { cn } from '@/lib/utils'

/** Images the requester may attach to a request (shown from the request to its end). */
export const MAX_REQUEST_IMAGES = 3

/** Request form: pick up to 3 images (photo of the broken part, an example of what is needed...). */
export function RequestImagesInput({ value, onChange, onError }: { value: string[]; onChange: (v: string[]) => void; onError?: (msg: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const add = async (files: FileList | null) => {
    if (!files?.length) return
    const room = MAX_REQUEST_IMAGES - value.length
    if (files.length > room) onError?.(`Maximum ${MAX_REQUEST_IMAGES} images.`)
    setReading(true)
    try {
      const made = await Promise.all([...files].slice(0, Math.max(0, room)).map((f) => photoToDataUrl(f, 1600)))
      onChange([...value, ...made].slice(0, MAX_REQUEST_IMAGES))
    } catch (e) {
      onError?.((e as Error).message)
    } finally {
      setReading(false)
    }
  }
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">Image <span className="font-normal text-muted-foreground">(optional, maximum {MAX_REQUEST_IMAGES}: item sample, damaged condition, etc.)</span></div>
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void add(e.target.files); e.target.value = '' }} />
      <div className="flex flex-wrap gap-2">
        {value.map((src, i) => (
          <div key={i} className="relative size-20 overflow-hidden rounded-lg border bg-muted">
            <img src={src} alt={`Image ${i + 1}`} className="size-full object-cover" />
            <button type="button" aria-label={`Delete image ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"><X className="size-3.5" /></button>
          </div>
        ))}
        {value.length < MAX_REQUEST_IMAGES && (
          <button type="button" onClick={() => input.current?.click()} disabled={reading}
            className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-xs text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary">
            {reading ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
            <span>{value.length}/{MAX_REQUEST_IMAGES}</span>
          </button>
        )}
      </div>
    </div>
  )
}

const imagePath = (requestId: number, slot: string, lineId?: number) => (lineId ? `/api/item-requests/${requestId}/lines/${lineId}/image/${slot}` : `/api/item-requests/${requestId}/image/${slot}`)
const imageKey = (requestId: number, slot: string, lineId?: number) => ['item-requests', requestId, 'image', lineId ?? 0, slot]

/** One image of a request, fetched with the session; a click shows them all in the popup. */
function SessionImage({ requestId, lineId, slot, size, onOpen }: { requestId: number; lineId?: number; slot: string; size: string; onOpen: () => void }) {
  const { data: url } = useQuery({
    queryKey: imageKey(requestId, slot, lineId),
    staleTime: Infinity,
    queryFn: async () => URL.createObjectURL((await api.get(imagePath(requestId, slot, lineId), { responseType: 'blob' })).data as Blob),
  })
  return (
    <button type="button" onClick={onOpen} className={cn('block shrink-0 cursor-zoom-in overflow-hidden rounded-lg border bg-muted', size)} title="View image">
      {url ? <img src={url} alt={`Image ${slot.replace('img', '')}`} className="size-full object-cover" /> : <div className="size-full animate-pulse" />}
    </button>
  )
}

/**
 * The images attached to a request — on its detail, the Approval page (Manager, Direktur, Gudang) and
 * the requester's status page (by track token, no account), so everyone handling it sees them.
 */
export function RequestImages({ requestId, lineId, slots, token, size = 'size-20', className }: {
  requestId?: number
  /** the images of one item (beside its name) instead of the whole request's */
  lineId?: number
  slots?: string[] | null; token?: string; size?: string; className?: string
}) {
  const qc = useQueryClient()
  if (!slots?.length) return null
  const pub = (slot: string) => `${api.defaults.baseURL ?? ''}/api/public/request-status/image?token=${token}&slot=${slot}${lineId ? `&line=${lineId}` : ''}`
  // every image of this request / item in the popup, opened on the one clicked
  const show = (i: number) => openImage(slots.map((slot) => ({
    alt: `Image ${slot.replace('img', '')}`,
    ...(token ? { src: pub(slot) } : {
      load: () => qc.fetchQuery({ queryKey: imageKey(requestId!, slot, lineId), staleTime: Infinity,
        queryFn: async () => URL.createObjectURL((await api.get(imagePath(requestId!, slot, lineId), { responseType: 'blob' })).data as Blob) }),
    }),
  })), i)
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {slots.map((slot, i) => token
        ? (
          <button key={slot} type="button" onClick={() => show(i)}
            className={cn('block shrink-0 cursor-zoom-in overflow-hidden rounded-lg border bg-muted', size)} title="View image">
            <img src={pub(slot)} alt={`Image ${slot.replace('img', '')}`} className="size-full object-cover" />
          </button>
        )
        : requestId ? <SessionImage key={slot} requestId={requestId} lineId={lineId} slot={slot} size={size} onOpen={() => show(i)} /> : null)}
    </div>
  )
}

/** Request form, one item: a small camera button beside its name, up to 3 images of that item. */
export function LineImagesInput({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const add = async (files: FileList | null) => {
    if (!files?.length) return
    setReading(true)
    try {
      const made = await Promise.all([...files].slice(0, Math.max(0, MAX_REQUEST_IMAGES - value.length)).map((f) => photoToDataUrl(f, 1600)))
      onChange([...value, ...made].slice(0, MAX_REQUEST_IMAGES))
    } finally {
      setReading(false)
    }
  }
  return (
    <div className="flex shrink-0 items-center gap-1">
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void add(e.target.files); e.target.value = '' }} />
      {value.map((src, i) => (
        <div key={i} className="relative size-9 overflow-hidden rounded-md border bg-muted">
          <img src={src} alt={`Image ${label} ${i + 1}`} className="size-full object-cover" />
          <button type="button" aria-label={`Delete image ${label} ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 transition-opacity hover:opacity-100"><X className="size-3.5" /></button>
        </div>
      ))}
      {value.length < MAX_REQUEST_IMAGES && (
        <button type="button" onClick={() => input.current?.click()} disabled={reading} title={`Add image ${label} (maks ${MAX_REQUEST_IMAGES})`} aria-label={`Add image ${label}`}
          className="flex size-9 items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary">
          {reading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
        </button>
      )}
    </div>
  )
}

/** The "Gambar" column of an item (rightmost in every request table): its images, or a dash. */
export function LineImagesCell({ requestId, lineId, slots }: { requestId: number; lineId: number; slots?: string[] | null }) {
  return slots?.length
    ? <RequestImages requestId={requestId} lineId={lineId} slots={slots} size="size-10" className="justify-end gap-1" />
    : <div className="text-right text-xs text-muted-foreground">-</div>
}
