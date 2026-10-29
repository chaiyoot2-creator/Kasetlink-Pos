import { useMemo } from 'react'
import { authUiForAppTokenReason, type AuthTokenExpiredError } from '../lib/api'
import { Button } from './ui/button'

interface AuthExpiredModalProps {
  onClose: () => void
  authError: AuthTokenExpiredError
}

/**
 * Auth failure modal — shown when AppTokenValidationError is mapped to AuthTokenExpiredError.
 * Copy depends on server `reason` (e.g. missing_gate_service_token is not a session timeout).
 */
export function AuthExpiredModal({ onClose, authError }: AuthExpiredModalProps) {
  const { title, body } = useMemo(
    () => authUiForAppTokenReason(authError.appTokenReason, authError.serverHint),
    [authError.appTokenReason, authError.serverHint],
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-lg bg-card p-6 shadow-xl">
        <h2 className="mb-2 text-lg font-semibold">{title}</h2>
        <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
        {authError.appTokenReason ? (
          <p className="mb-6 font-mono text-xs text-muted-foreground">reason: {authError.appTokenReason}</p>
        ) : (
          <div className="mb-6" />
        )}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" className="cursor-pointer" onClick={onClose}>
            ปิด
          </Button>
          <Button className="cursor-pointer" onClick={() => window.location.reload()}>
            รีเฟรชหน้า
          </Button>
        </div>
      </div>
    </div>
  )
}
