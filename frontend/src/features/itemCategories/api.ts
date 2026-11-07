import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type CategoryLevel = 'induk' | 'anak_1' | 'anak_2' | 'anak_3'

export const CATEGORY_LEVELS: { level: CategoryLevel; label: string }[] = [
  { level: 'induk', label: 'Main Category' },
  { level: 'anak_1', label: 'Sub Category 1' },
  { level: 'anak_2', label: 'Sub Category 2' },
  { level: 'anak_3', label: 'Sub Category 3' },
]

export interface ItemCategory {
  id: number
  name: string
  /** Kategori Induk: the item-code prefixes that mean it, e.g. "MAA,MNA" */
  code_prefix: string | null
  is_active: boolean
  items_count: number
}

export function useItemCategories(level: CategoryLevel) {
  return useQuery({
    queryKey: ['item-categories', level],
    queryFn: async () => (await api.get<{ data: ItemCategory[]; unlisted: { name: string; items_count: number }[] }>('/api/item-categories', { params: { level } })).data,
  })
}

export function useItemCategoryMutations() {
  const qc = useQueryClient()
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['item-categories'] })
    void qc.invalidateQueries({ queryKey: ['items'] })
  }
  return {
    create: useMutation({
      mutationFn: async (b: { level: CategoryLevel; name: string; code_prefix?: string | null }) => (await api.post('/api/item-categories', b)).data,
      meta: { successMessage: 'Category added.' }, onSuccess: done,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...b }: { id: number; name?: string; code_prefix?: string | null; is_active?: boolean }) =>
        (await api.put<{ items_moved: number }>(`/api/item-categories/${id}`, b)).data,
      meta: { successMessage: false }, onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: async (id: number) => (await api.delete(`/api/item-categories/${id}`)).data,
      meta: { successMessage: 'Category deleted.' }, onSuccess: done,
    }),
  }
}
