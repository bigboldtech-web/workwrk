// The login outcome that asks a person to set up two step verification in
// the login card (spec-account-auth `/login` step 2b). Client safe: the
// login form reads it; the ticket itself is minted server side in
// mfa-enrol-ticket.ts.

export const MFA_ENROL_REQUIRED = "MFA_ENROL_REQUIRED";

/** The ticket inside a login error ("MFA_ENROL_REQUIRED:<ticket>"), or null when the error is something else. */
export function ticketFromLoginError(error: string | null | undefined): string | null {
  if (!error || !error.startsWith(`${MFA_ENROL_REQUIRED}:`)) return null;
  const t = error.slice(MFA_ENROL_REQUIRED.length + 1);
  return t || null;
}
