import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface UomUnit {
  id: number
  code: string
  name: string
  is_active: boolean
  uom_category_id: number | null
  is_reference: boolean
  /** 1 of this unit = ratio × the category's reference; null = it differs per item */
  ratio: number | null
  /** a converted quantity lands on a multiple of this */
  rounding: number
  items_count: number
  /** what an admin typed for a Bigger / Smaller unit (60 for MIN: 60 in one HOUR), kept exactly */
  factor?: number | null
  kind?: 'REFERENCE' | 'BIGGER' | 'SMALLER' | 'PER_ITEM' | null
}

export interface UomCategory { id: number; name: string; units: UomUnit[] }

export type UomKind = 'REFERENCE' | 'BIGGER' | 'SMALLER' | 'VARIES'

export interface ItemUnitConversion {
  id: number | null
  unit_id: number | null
  code: string
  /** 1 of this unit = ratio × the item's own unit */
  ratio: number
  /** ACCURATE ones are changed in Accurate */
  source: 'ACCURATE' | 'MANUAL'
  /** set against a former base unit of the item: not used until confirmed or corrected */
  needs_review?: boolean
  /** the base unit the ratio was set against */
  set_against?: string | null
}

export function useUom() {
  return useQuery({
    queryKey: ['uom'],
    queryFn: async () => (await api.get<{ data: { categories: UomCategory[]; uncategorized: UomUnit[] } }>('/api/uom')).data.data,
  })
}

export function useItemConversions(itemId: number | null) {
  return useQuery({
    queryKey: ['uom', 'item', itemId],
    enabled: itemId != null,
    queryFn: async () => (await api.get<{ data: { item: { id: number; code: string; description: string; unit_id: number | null; unit: string | null }; conversions: ItemUnitConversion[] } }>(`/api/items/${itemId}/unit-conversions`)).data.data,
  })
}

export async function convertUom(params: { qty: number; from: number; to: number; item_id?: number | null }) {
  return (await api.get<{ data: { factor: number; result: number } }>('/api/uom/convert', { params })).data.data
}

/** What a document line makes in the item's Base UOM. Nothing is saved. */
export async function uomPreview(params: { qty: number; unit: string; item_id?: number; item_code?: string }) {
  return (await api.get<{ data: { converts: boolean; known: boolean; ratio: number; base_unit: string | null; base_qty: number; problem: string | null } }>('/api/uom/preview', { params })).data.data
}

export interface UomUnmapped {
  items: { id: number; code: string; description: string }[]
  items_total: number
  units: { id: number; code: string; name: string }[]
  /** words written on Item Requests that are no unit of the master */
  requested: { unit: string; lines_count: number }[]
}

export function useUomUnmapped(enabled: boolean) {
  return useQuery({
    queryKey: ['uom', 'unmapped'],
    enabled,
    queryFn: async () => (await api.get<{ data: UomUnmapped }>('/api/uom/unmapped')).data.data,
  })
}

export function useUomActions() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['uom'] })
  return {
    saveCategory: useMutation({
      mutationFn: async ({ id, name }: { id?: number; name: string }) => (id ? api.put(`/api/uom/categories/${id}`, { name }) : api.post('/api/uom/categories', { name })),
      meta: { successMessage: false },
      onSuccess: done,
    }),
    deleteCategory: useMutation({
      mutationFn: async (id: number) => api.delete(`/api/uom/categories/${id}`),
      onSuccess: done,
    }),
    saveUnit: useMutation({
      mutationFn: async ({ id, ...body }: { id?: number; code: string; name: string; is_active: boolean; uom_category_id: number | null; kind: UomKind | null; factor: number | null; rounding: number }) =>
        (id ? api.put(`/api/uom/units/${id}`, body) : api.post('/api/uom/units', body)),
      meta: { successMessage: false },
      onSuccess: () => { done(); qc.invalidateQueries({ queryKey: ['units'] }) },
    }),
    saveItemConversion: useMutation({
      mutationFn: async ({ itemId, ...body }: { itemId: number; unit_id: number; ratio: number }) => api.post(`/api/items/${itemId}/unit-conversions`, body),
      meta: { successMessage: false },
      onSuccess: done,
    }),
    setBaseUnit: useMutation({
      mutationFn: async ({ itemId, unit_id }: { itemId: number; unit_id: number }) => api.put(`/api/items/${itemId}/base-unit`, { unit_id }),
      meta: { successMessage: 'Base UOM set.' },
      onSuccess: done,
    }),
    confirmItemConversion: useMutation({
      mutationFn: async ({ itemId, id }: { itemId: number; id: number }) => api.post(`/api/items/${itemId}/unit-conversions/${id}/confirm`),
      meta: { successMessage: 'Conversion confirmed.' },
      onSuccess: () => { done(); qc.invalidateQueries({ queryKey: ['master-data-quality'] }) },
    }),
    deleteItemConversion: useMutation({
      mutationFn: async ({ itemId, id }: { itemId: number; id: number }) => api.delete(`/api/items/${itemId}/unit-conversions/${id}`),
      onSuccess: done,
    }),
  }
}

export type RuleStatus = 'NOT_SET' | 'PARTIAL' | 'COMPLETE'

export interface CategoryRuleUnit {
  unit_id: number
  code: string
  name: string
  is_default: boolean
  kind: 'REFERENCE' | 'BIGGER' | 'SMALLER' | 'PER_ITEM' | null
  factor: number | null
  /** the reference of the unit's measurement category (PCS, MTR, KG …) */
  reference: string | null
  /** per-item units only: pre-fills an item's own ratio */
  suggested_ratio: number | null
  items_count: number
  is_active: boolean
}

export interface CategoryRule {
  id: number
  name: string
  path: string
  parent_id: number | null
  level: number
  items_count: number
  status: RuleStatus
  units: CategoryRuleUnit[]
  /** units the category's items use that the rules do not list (those items are shown, not blocked) */
  outside: { unit_id: number; code: string; items_count: number }[]
}

/** Master UOM › Parent Category: every parent category with its allowed units. */
export function useCategoryRules(enabled = true) {
  return useQuery({
    queryKey: ['uom', 'category-rules'],
    enabled,
    queryFn: async () => (await api.get<{ data: CategoryRule[] }>('/api/uom/category-rules')).data.data,
  })
}

export function useSaveCategoryRules() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ categoryId, units }: { categoryId: number; units: { unit_id: number; is_default: boolean; suggested_ratio: number | null }[] }) =>
      api.put(`/api/uom/category-rules/${categoryId}`, { units }),
    meta: { successMessage: 'Category units saved.' },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['uom'] }); qc.invalidateQueries({ queryKey: ['items', 'options'] }) },
  })
}
