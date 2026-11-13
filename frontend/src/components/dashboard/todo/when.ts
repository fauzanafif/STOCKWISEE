const DAY = 86_400_000

/** "Today 14:05" / "Tomorrow 09:00" / "Yesterday 16:30" / "12/11/2026 09:00"; a date without a time stays a date. */
export function fmtWhen(iso: string): string {
  const d = new Date(iso)
  const dateOnly = d.getHours() === 0 && d.getMinutes() === 0
  const time = dateOnly ? '' : ` ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / DAY)
  if (days === 0) return `Today${time}`
  if (days === 1) return `Tomorrow${time}`
  if (days === -1) return `Yesterday${time}`
  return d.toLocaleDateString('en-GB') + time
}
