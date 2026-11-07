import { Check, Loader2 } from 'lucide-react'
import type { SaveState } from './useInlineRowEditor'

/** Small inline status next to a row being edited in place (see useInlineRowEditor). */
export function InlineSaveBadge({ state, error, hint }: { state: SaveState; error?: string | null; hint?: string | null }) {
  if (state === 'saving') return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Saving…</span>
  if (state === 'saved') return <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check className="size-3" /> Saved</span>
  if (state === 'error') return <span className="text-xs text-destructive">{error ?? 'Failed to save'}</span>
  if (hint) return <span className="text-xs text-amber-700">{hint}</span>
  return null
}
