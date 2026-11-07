import { useState } from 'react'
import { useChangeOwnPassword } from '@/features/admin/api'
import { apiErrorMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const change = useChangeOwnPassword()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    setErr(null)
    if (password !== confirm) {
      setErr('The new password confirmation does not match.')
      return
    }
    change.mutate(
      { current_password: current, password, password_confirmation: confirm },
      { onSuccess: onClose, onError: (e) => setErr(apiErrorMessage(e)) },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Change Password"
      description="Login sessions on other devices will end after the password changes."
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={change.isPending || !current || password.length < 8} onClick={submit}>Save</Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <div className="space-y-1">
          <Label htmlFor="cp-current">Current password</Label>
          <PasswordInput id="cp-current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cp-new">New password</Label>
          <PasswordInput id="cp-new" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cp-confirm">Repeat new password</Label>
          <PasswordInput id="cp-confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">Minimum 8 characters, with letters and numbers.</p>
        {err && <p className="whitespace-pre-line text-sm text-destructive">{err}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
