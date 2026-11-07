import { Info, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { AlertType } from '@/features/updateAlerts/api'

export const ALERT_TYPES: Record<AlertType, { label: string; icon: LucideIcon; band: string; circle: string; button: string; bullet: string; badge: 'default' | 'warning' | 'neutral'; pill: string }> = {
  feature: {
    label: 'New Feature', icon: Sparkles, band: 'from-violet-200 via-fuchsia-100 to-indigo-100', circle: 'bg-violet-600 shadow-violet-300',
    button: 'bg-violet-600 hover:bg-violet-700 focus-visible:ring-violet-400', bullet: 'bg-violet-100 text-violet-700', badge: 'default', pill: 'bg-violet-50 text-violet-700',
  },
  warning: {
    label: 'Warning', icon: TriangleAlert, band: 'from-amber-200 via-orange-100 to-yellow-100', circle: 'bg-amber-500 shadow-amber-300',
    button: 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-400', bullet: 'bg-amber-100 text-amber-700', badge: 'warning', pill: 'bg-amber-50 text-amber-800',
  },
  info: {
    label: 'Information', icon: Info, band: 'from-sky-200 via-blue-100 to-cyan-100', circle: 'bg-blue-600 shadow-blue-300',
    button: 'bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-400', bullet: 'bg-blue-100 text-blue-700', badge: 'default', pill: 'bg-blue-50 text-blue-700',
  },
}
