// The security activity list's plain words (spec-account-auth
// `/account/security` card 3). One table, tested, so the naming canon holds:
// "Log in", "Log out", "Two step verification", "Log out everywhere".

export const SECURITY_EVENT_LABEL: Readonly<Record<string, string>> = {
  login: "Logged in",
  logout: "Logged out",
  password_changed: "Password changed",
  password_reset: "Password reset from an emailed link",
  mfa_enabled: "Two step verification turned on",
  mfa_disabled: "Two step verification turned off",
  mfa_backup_codes_regenerated: "New backup codes created",
  signed_out_all_devices: "Logged out everywhere",
  "org.switch.in": "Workspace switched",
};
