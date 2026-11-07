import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2, ShieldAlert } from 'lucide-react'
import { useAuth } from './AuthContext'

export function RequireAuth() {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />

  return <Outlet />
}

export function RequirePermission({ permission }: { permission: string | string[] }) {
  const { hasPermission } = useAuth()
  const needed = Array.isArray(permission) ? permission : [permission]

  if (!needed.some((p) => hasPermission(p))) return <NoAccess needs={`Permissions: ${needed.join(' / ')}`} />
  return <Outlet />
}

/** A page for one role only, which no permission on the Roles page can open. */
export function RequireRole({ role }: { role: string }) {
  const { hasRole } = useAuth()
  return hasRole(role) ? <Outlet /> : <NoAccess needs={`Role: ${role}`} />
}

function NoAccess({ needs }: { needs: string }) {
  return (
    <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-2 rounded-lg border bg-card px-6 py-12 text-center">
      <ShieldAlert className="size-9 text-muted-foreground" />
      <p className="font-medium">You have no access to this page</p>
      <p className="text-sm text-muted-foreground" title={needs}>Contact the admin if you need it.</p>
      <Link to="/" className="mt-2 text-sm font-medium text-primary hover:underline">Back to Dashboard</Link>
    </div>
  )
}

function FullScreenLoader() {
  return (
    <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">
      <span className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Loading STOCKWISE…</span>
    </div>
  )
}
