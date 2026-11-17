import { Link, useParams } from 'react-router-dom'
import { Hourglass, LayoutGrid } from 'lucide-react'
import { launcherApp } from '@/lib/launcher'
import { APPS_HOME } from '@/lib/navigation'
import { cn } from '@/lib/utils'

/** A launcher app that has no module yet: says so, and leads back to the launcher. */
export function ComingSoonPage() {
  const { app: key } = useParams()
  const app = launcherApp(key)
  const Icon = app?.icon ?? Hourglass

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <span className={cn('flex size-20 items-center justify-center rounded-3xl bg-gradient-to-br text-white shadow-sm', app?.color ?? 'from-slate-500 to-slate-700')}>
        <Icon className="size-10" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">{app?.label ?? 'Aplikasi'}: Coming Soon</h1>
        <p className="text-sm text-muted-foreground">
          {app ? `Modul ${app.label} (${app.description.toLowerCase()}) sedang disiapkan dan belum bisa dipakai.` : 'Aplikasi ini belum tersedia.'}
        </p>
      </div>
      <Link to={APPS_HOME} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        <LayoutGrid className="size-4" /> Kembali ke App Launcher
      </Link>
    </div>
  )
}
