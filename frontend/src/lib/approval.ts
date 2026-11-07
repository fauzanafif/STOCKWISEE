/** A Manager step the Direktur approved for them (bypass): its log note says so. */
export const isAutoApproval = (note?: string | null) => !!note && note.startsWith('Disetujui otomatis')

export const BYPASS_TEXT = 'Manager: approved automatically (Director bypass)'

const STEP_TEXT: Record<string, string> = {
  DIAJUKAN: 'Submitted',
  APPROVE_MANAGER: 'Approved by Manager',
  APPROVE: 'Approved by Director',
  REJECT: 'Rejected',
  RETURN: 'Returned for revision',
  DIAJUKAN_ULANG: 'Resubmitted (revised)',
  PO_TANPA_APPROVAL: 'PO made without approval',
  DIBELI: 'Purchased',
}

/**
 * One approval log entry in plain words (PPB / NPBG / PO: action only; Request Barang: stage + action),
 * the bypassed Manager step said clearly.
 */
export function stepText(action: string, note?: string | null, stage?: string | null): string {
  if ((action === 'APPROVE_MANAGER' || (stage === 'MANAGER' && action === 'APPROVE')) && isAutoApproval(note)) return BYPASS_TEXT
  if (stage === 'MANAGER' && action === 'APPROVE') return 'Approved by Manager'
  return STEP_TEXT[action] ?? action
}
