import { useState } from 'react'
import { apiErrorMessage } from '@/lib/api'
import { MAX_SECONDS, MIN_SECONDS, useAutoRefresh, useSaveAutoRefresh, type AutoRefresh } from '@/features/autoRefresh/api'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const PRESETS = [3, 5, 10, 15, 30, 60]

function AutoRefreshForm({ saved }: { saved: AutoRefresh }) {
  const save = useSaveAutoRefresh()
  const [enabled, setEnabled] = useState(saved.enabled)
  const [seconds, setSeconds] = useState(String(saved.seconds))
  const [custom, setCustom] = useState(!PRESETS.includes(saved.seconds))
  const [err, setErr] = useState<string | null>(null)

  const value = Number(seconds)
  const changed = enabled !== saved.enabled || value !== saved.seconds

  const submit = () => {
    setErr(null)
    if (!Number.isInteger(value) || value < MIN_SECONDS || value > MAX_SECONDS) {
      setErr(`Fill in ${MIN_SECONDS} to ${MAX_SECONDS} seconds.`)
      return
    }
    save.mutate({ enabled, seconds: value }, { onError: (e) => setErr(apiErrorMessage(e)) })
  }

  return (
    <div className="max-w-2xl space-y-5 rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span id="ar-label" className="text-sm font-medium">Auto refresh</span>
          {saved.enabled ? <Badge variant="success">On · every {saved.seconds}s</Badge> : <Badge variant="neutral">Off</Badge>}
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-labelledby="ar-label" onClick={() => setEnabled((v) => !v)}
          className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', enabled ? 'bg-primary' : 'bg-slate-300')}>
          <span className={cn('absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform', enabled && 'translate-x-5')} />
        </button>
      </div>

      <div className={cn('space-y-2', !enabled && 'opacity-50')}>
        <Label>Refresh every</Label>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((s) => {
            const on = !custom && value === s
            return (
              <button key={s} type="button" disabled={!enabled} aria-pressed={on} onClick={() => { setCustom(false); setSeconds(String(s)) }}
                className={cn('h-9 rounded-full border px-3.5 text-sm tabular-nums transition-colors', on ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted')}>
                {s} sec
              </button>
            )
          })}
          <button type="button" disabled={!enabled} aria-pressed={custom} onClick={() => setCustom(true)}
            className={cn('h-9 rounded-full border px-3.5 text-sm transition-colors', custom ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted')}>
            Custom
          </button>
        </div>
        {custom && (
          <div className="flex items-center gap-2 pt-1">
            <Input aria-label="Seconds" type="number" min={MIN_SECONDS} max={MAX_SECONDS} step={1} className="w-28" disabled={!enabled} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
            <span className="text-sm text-muted-foreground">seconds</span>
          </div>
        )}
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end border-t pt-3">
        <Button size="sm" onClick={submit} disabled={save.isPending || !changed}>{save.isPending ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  )
}

/** Settings · Auto Refresh (Super Admin): how often every open tab picks up what others changed. */
export function AutoRefreshPage() {
  const { data } = useAutoRefresh()
  return (
    <div className="space-y-4">
      <PageHeader title="Settings · Auto Refresh" />
      {data && <AutoRefreshForm saved={data} />}
    </div>
  )
}
