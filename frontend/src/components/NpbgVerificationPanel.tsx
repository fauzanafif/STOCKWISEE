import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  fileToDataUrl,
  isVerificationOpen,
  useBosDecide,
  useEscalateVerification,
  useNpbgVerifications,
  useOfferAlternative,
  useOpenVerification,
  useProcessVerification,
  useRespondVerification,
  type NpbgVerification,
  type VerificationStatus,
} from '@/features/npbg/verification-api'
import { useAuth } from '@/auth/AuthContext'
import { apiErrorMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'

const STATUS_LABEL: Record<VerificationStatus, string> = {
  DIAJUKAN: 'Submitted',
  DIPROSES: 'In process',
  ALTERNATIF_DITAWARKAN: 'Alternative Offered',
  MENUNGGU_RESPON: 'Waiting for Response',
  PERLU_VERIFIKASI_BOS: 'Needs BOSS Verification',
  DISETUJUI: 'Approved',
  DITOLAK: 'Rejected',
  SELESAI: 'Done',
}

function statusVariant(status: VerificationStatus): 'default' | 'warning' | 'success' | 'danger' | 'neutral' {
  if (status === 'SELESAI' || status === 'DISETUJUI') return 'success'
  if (status === 'DITOLAK') return 'danger'
  if (status === 'PERLU_VERIFIKASI_BOS') return 'warning'
  return 'default'
}

function StatusBadge({ status }: { status: VerificationStatus }) {
  return <Badge variant={statusVariant(status)}>{STATUS_LABEL[status]}</Badge>
}

function AttachmentInput({ onChange }: { onChange: (dataUrl: string | undefined) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">Attachments (optional: proof photos/documents)</label>
      <input
        type="file"
        accept="image/*,.pdf"
        className="block w-full text-xs"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          onChange(file ? await fileToDataUrl(file) : undefined)
        }}
      />
    </div>
  )
}

function OpenForm({ npbgId, onDone }: { npbgId: number; onDone: () => void }) {
  const open = useOpenVerification(npbgId)
  const [alasan, setAlasan] = useState('')
  const [attachment, setAttachment] = useState<string>()
  const [err, setErr] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      <Textarea placeholder="Reason for clarification, e.g. the issued item differs in brand/spec from the request"
        value={alasan} onChange={(e) => setAlasan(e.target.value)} />
      <AttachmentInput onChange={setAttachment} />
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onDone}>Cancel</Button>
        <Button size="sm" disabled={!alasan || open.isPending}
          onClick={() => open.mutate({ alasan_pengajuan: alasan, attachment },
            { onSuccess: onDone, onError: (e) => setErr(apiErrorMessage(e)) })}>
          Submit
        </Button>
      </div>
    </div>
  )
}

function VerificationCase({ npbgId, v }: { npbgId: number; v: NpbgVerification }) {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('npbg.verification.manage')
  const canRespond = hasPermission('npbg.verification.respond')
  const canBosDecide = hasPermission('npbg.verification.bos_decide')

  const process = useProcessVerification(npbgId, v.id)
  const offer = useOfferAlternative(npbgId, v.id)
  const respond = useRespondVerification(npbgId, v.id)
  const escalate = useEscalateVerification(npbgId, v.id)
  const bosDecide = useBosDecide(npbgId, v.id)

  const [modal, setModal] = useState<'offer' | 'reject' | 'bos' | null>(null)
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<string>()
  const [err, setErr] = useState<string | null>(null)

  const closeModal = () => { setModal(null); setText(''); setAttachment(undefined); setErr(null) }

  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusBadge status={v.status} />
          <span className="text-xs text-muted-foreground">
            Submitted {v.opened_by ? `by ${v.opened_by}` : ''} · {new Date(v.created_at).toLocaleString('en-GB')}
          </span>
        </div>
        <p><span className="text-muted-foreground">Clarification reason:</span> {v.alasan_pengajuan ?? '—'}</p>
        {v.deskripsi_alternatif && <p><span className="text-muted-foreground">Alternative item:</span> {v.deskripsi_alternatif}</p>}
        {v.alasan_penolakan && <p><span className="text-muted-foreground">Maintenance rejection reason:</span> {v.alasan_penolakan}</p>}
        {v.keputusan_bos && (
          <p>
            <span className="text-muted-foreground">BOSS decision:</span> {v.keputusan_bos}
            {v.catatan_bos ? ` — ${v.catatan_bos}` : ''}
          </p>
        )}

        {err && <p className="text-sm text-destructive">{err}</p>}

        <div className="flex flex-wrap gap-2">
          {v.status === 'DIAJUKAN' && canManage && (
            <Button size="sm" variant="outline" disabled={process.isPending}
              onClick={() => process.mutate({}, { onError: (e) => setErr(apiErrorMessage(e)) })}>
              Process
            </Button>
          )}
          {v.status === 'DIPROSES' && canManage && (
            <Button size="sm" variant="outline" onClick={() => setModal('offer')}>Offer Alternative</Button>
          )}
          {v.status === 'MENUNGGU_RESPON' && canRespond && (
            <>
              <Button size="sm" disabled={respond.isPending}
                onClick={() => respond.mutate({ decision: 'ACCEPT' }, { onError: (e) => setErr(apiErrorMessage(e)) })}>
                Accept Alternative
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setModal('reject')}>Reject</Button>
            </>
          )}
          {isVerificationOpen(v.status) && v.status !== 'PERLU_VERIFIKASI_BOS' && canManage && (
            <Button size="sm" variant="outline" disabled={escalate.isPending}
              onClick={() => escalate.mutate({}, { onError: (e) => setErr(apiErrorMessage(e)) })}>
              Escalate to BOSS
            </Button>
          )}
          {v.status === 'PERLU_VERIFIKASI_BOS' && canBosDecide && (
            <Button size="sm" onClick={() => setModal('bos')}>BOSS decision</Button>
          )}
        </div>

        {v.logs && v.logs.length > 0 && (
          <details className="pt-1">
            <summary className="cursor-pointer text-xs text-muted-foreground">Audit trail history ({v.logs.length})</summary>
            <ul className="mt-2 space-y-1.5 border-l pl-3">
              {v.logs.map((l) => (
                <li key={l.id} className="text-xs">
                  <span className="font-medium">{l.actor ?? 'System'}</span> — {l.action}
                  {l.to_status && <> → <span className="">{l.to_status}</span></>}
                  {l.note && <>: {l.note}</>}
                  {l.has_attachment && l.attachment_url && (
                    <> · <a className="text-primary underline" href={l.attachment_url} target="_blank" rel="noreferrer">attachments</a></>
                  )}
                  <span className="text-muted-foreground"> · {new Date(l.created_at).toLocaleString('en-GB')}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>

      <Modal open={modal === 'offer'} onClose={closeModal} title="Offer Alternative Item">
        <div className="space-y-3">
          <Textarea placeholder="Description of the alternative item offered" value={text} onChange={(e) => setText(e.target.value)} />
          <AttachmentInput onChange={setAttachment} />
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={closeModal}>Cancel</Button>
            <Button size="sm" disabled={!text || offer.isPending}
              onClick={() => offer.mutate({ deskripsi_alternatif: text, attachment },
                { onSuccess: closeModal, onError: (e) => setErr(apiErrorMessage(e)) })}>
              Send to Maintenance
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'reject'} onClose={closeModal} title="Reject Alternative Item" description="The reason is required.">
        <div className="space-y-3">
          <Textarea placeholder="Rejection reason" value={text} onChange={(e) => setText(e.target.value)} />
          <AttachmentInput onChange={setAttachment} />
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={closeModal}>Cancel</Button>
            <Button size="sm" variant="destructive" disabled={!text || respond.isPending}
              onClick={() => respond.mutate({ decision: 'REJECT', reason: text, attachment },
                { onSuccess: closeModal, onError: (e) => setErr(apiErrorMessage(e)) })}>
              Reject &amp; Escalate to BOSS
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'bos'} onClose={closeModal} title="BOSS decision">
        <div className="space-y-3">
          <Textarea placeholder="Notes (optional)" value={text} onChange={(e) => setText(e.target.value)} />
          <AttachmentInput onChange={setAttachment} />
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="destructive" disabled={bosDecide.isPending}
              onClick={() => bosDecide.mutate({ keputusan: 'DITOLAK', catatan: text, attachment },
                { onSuccess: closeModal, onError: (e) => setErr(apiErrorMessage(e)) })}>
              Reject
            </Button>
            <Button size="sm" disabled={bosDecide.isPending}
              onClick={() => bosDecide.mutate({ keputusan: 'DISETUJUI', catatan: text, attachment },
                { onSuccess: closeModal, onError: (e) => setErr(apiErrorMessage(e)) })}>
              Approve
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  )
}

export function NpbgVerificationPanel({ npbgId }: { npbgId: number }) {
  const { hasPermission } = useAuth()
  const { data: verifications, isLoading } = useNpbgVerifications(npbgId)
  const [showOpenForm, setShowOpenForm] = useState(false)

  if (!hasPermission('npbg.verification.view')) return null

  const hasActive = (verifications ?? []).some((v) => isVerificationOpen(v.status))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="size-4" /> Item Clarification / Verification
        </h2>
        {!hasActive && hasPermission('npbg.verification.manage') && !showOpenForm && (
          <Button size="sm" variant="outline" onClick={() => setShowOpenForm(true)}>Request Clarification</Button>
        )}
      </div>

      {showOpenForm && (
        <Card><CardContent className="p-4"><OpenForm npbgId={npbgId} onDone={() => setShowOpenForm(false)} /></CardContent></Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && (verifications ?? []).length === 0 && !showOpenForm && (
        <p className="text-sm text-muted-foreground">
          No clarification for this Delivery Order yet; used when the issued item turns out to differ in type/spec.
        </p>
      )}

      <div className="space-y-3">
        {verifications?.map((v) => <VerificationCase key={v.id} npbgId={npbgId} v={v} />)}
      </div>
    </div>
  )
}
