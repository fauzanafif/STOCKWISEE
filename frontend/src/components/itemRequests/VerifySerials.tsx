import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SerialPicker } from '@/components/npbg/SerialPicker'
import { useNpbgSerials } from '@/features/npbg/api'
import { uomPreview } from '@/features/uom/api'

/**
 * Admin gudang verifying an item with serial numbers: pick the serials of the units given from stock
 * (one per unit in the item's own unit; at most what is in stock, the rest is bought). They are held for
 * this request and go out at the handover. Renders nothing for an item without serial numbers.
 */
export function VerifySerials({ code, itemId, itemUnit, qty, unit, requestId, picked, onChange, onNeed }: {
  code: string; itemId: number; itemUnit: string | null; qty: number; unit: string; requestId: number
  picked: string[]; onChange: (v: string[]) => void
  /** how many must be picked (null: not an item with serial numbers / not known yet) */
  onNeed?: (need: number | null) => void
}) {
  const sn = useNpbgSerials(code, requestId)
  const managed = !!sn.data?.meta.manage_sn
  const other = !!unit && !!itemUnit && unit.toUpperCase() !== itemUnit.toUpperCase()
  const conv = useQuery({
    queryKey: ['uom', 'preview', JSON.stringify([qty, unit, itemId, ''])],
    enabled: managed && other && qty > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: () => uomPreview({ qty, unit, item_id: itemId }),
  })
  const base = !other ? qty : conv.data?.converts ? Number(conv.data.base_qty) : conv.data ? qty : NaN
  const whole = Number.isFinite(base) && Math.floor(base) === base
  const list = sn.data?.data ?? []
  const need = managed && whole ? Math.min(base, list.length) : null
  useEffect(() => { onNeed?.(managed ? need : null) }, [managed, need]) // eslint-disable-line react-hooks/exhaustive-deps
  // a picked serial no longer in stock (or the quantity went down): keep only what still fits
  useEffect(() => {
    if (need == null || sn.isLoading) return
    const ok = picked.filter((p) => list.some((s) => s.serial === p)).slice(0, need)
    if (ok.length !== picked.length) onChange(ok)
  }, [need, sn.isLoading, list.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!managed) return null
  if (Number.isFinite(base) && !whole) return <p className="text-xs text-red-600">{code} uses serial numbers: the quantity must be a whole number of {itemUnit}.</p>
  return (
    <div className="space-y-1">
      <SerialPicker serials={list} loading={sn.isLoading} need={need ?? 0} picked={picked} onChange={onChange} />
      {need != null && base > need && (
        <p className="text-xs text-amber-700">Only {need} in stock with a serial number; the other {base - need} are bought and their serials picked when they arrive.</p>
      )}
    </div>
  )
}
