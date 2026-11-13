import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useReminders } from '@/features/reminders/api'
import { TodoBoard } from '@/components/dashboard/todo/TodoBoard'

/** The home page: the greeting and the To-Do board. The analyses live on their own page (/analytics). */
export function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { data: waiting } = useReminders()
  const meta = waiting?.meta

  // an old /?tab= link (an analysis section) goes on to the analytics page
  useEffect(() => {
    const tab = params.get('tab')
    if (tab) navigate(`/analytics?tab=${encodeURIComponent(tab)}`, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null
  const hour = new Date().getHours()
  const greet = hour < 11 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="space-y-4 pb-6">
      <div className="rounded-xl bg-gradient-to-r from-[#1e3a8a] via-[#1d4ed8] to-[#2563eb] p-4 text-white sm:p-5">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{greet}, {user.name.split(' ')[0]}</h1>
          <p className="mt-0.5 text-[13px] text-blue-100">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {user.roles.join(', ')}</p>
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
          {[['To do', meta?.total ?? 0], ['Late', meta?.overdue ?? 0], ['Urgent', meta?.urgent ?? 0]].map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2"><dd className="text-2xl font-semibold tabular-nums">{Number(v).toLocaleString('id-ID')}</dd><dt className="text-[13px] text-blue-100">{k}</dt></div>
          ))}
        </dl>
      </div>

      <TodoBoard />
    </div>
  )
}
