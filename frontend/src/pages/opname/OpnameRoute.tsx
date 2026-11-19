import { useParams } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { useOpnameDetail } from '@/features/opname/workflow'
import { BackLink } from '@/components/BackLink'
import { DetailFallback } from '@/components/DetailFallback'
import { OpnameDetailPage } from '@/pages/OpnameDetailPage'
import { OpnameWorkspacePage } from './OpnameWorkspacePage'

/**
 * /stock-opnames/:id — an internal document opens in the controlled workflow; an Accurate ITEMADJ mirror (and every
 * document while the server's workflow migration has not run: 503) keeps the earlier read-only / legacy page.
 */
export function OpnameRoute() {
  const id = Number(useParams().id)
  const { data, isLoading, error } = useOpnameDetail(id)
  if (isLoading) return <div className="space-y-4"><BackLink to="/stock-opnames" label="Stock Opname" /><DetailFallback loading /></div>
  if ((error && isAxiosError(error) && error.response?.status === 503) || data?.from_accurate) return <OpnameDetailPage />
  if (!data) return <div className="space-y-4"><BackLink to="/stock-opnames" label="Stock Opname" /><DetailFallback loading={false} /></div>
  return <OpnameWorkspacePage key={data.id} o={data} />
}
