import { AxiosError } from 'axios'
import { apiErrorMessage } from '@/lib/api'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/lib/notify'

/** What the server found when the same document was already made (App\Support\DuplicateGuard), or null. */
function duplicateOf(error: unknown): { message: string; confirmable: boolean } | null {
  if (!(error instanceof AxiosError) || error.response?.status !== 422) return null
  const msg = (error.response.data as { errors?: Record<string, string[]> } | undefined)?.errors?.duplicate?.[0]
  // a look-alike may be saved once the user confirms it is another one; the same line of one document never
  return msg ? { message: msg, confirmable: msg.includes('Save anyway') } : null
}

/**
 * Saves a manual NPBG / PPB / PO / RI; when the server finds the same one already made (admin A and
 * admin B entering one request), it asks first and saves only on "Save anyway" (allow_duplicate).
 */
export function saveOnce<P extends object, R>(
  mutate: (payload: P & { allow_duplicate?: boolean }, opts: { onSuccess: (r: R) => void; onError: (e: unknown) => void }) => void,
  payload: P,
  onSuccess: (r: R) => void,
  onError: (message: string) => void,
) {
  mutate(payload, {
    onSuccess,
    onError: async (e) => {
      const dup = duplicateOf(e)
      if (!dup) return onError(apiErrorMessage(e))
      if (!dup.confirmable) {
        toast.invalid(dup.message)
        return onError(dup.message)
      }
      const ok = await confirmDialog({
        title: 'Possibly created twice',
        message: `${dup.message.replace(/ Kalau memang.*$/, '')}\n\nMake sure this is not the same request (e.g. already processed by another admin). Save as a new document anyway?`,
        confirmLabel: 'Save anyway',
        cancelLabel: 'Cancel',
      })
      if (!ok) return onError('Not saved: the same document already exists.')
      mutate({ ...payload, allow_duplicate: true }, { onSuccess, onError: (e2) => onError(apiErrorMessage(e2)) })
    },
  })
}
