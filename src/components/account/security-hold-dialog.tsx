"use client";

// Security hold dialog (spec-account-auth): when the workspace's rules
// change under a signed-in person, say what must happen before they carry
// on. Raised from /api/boot's `session.hold` (src/lib/auth/security-policy.ts):
//
//   mfa       the org requires two step verification for their role and
//             they are not enrolled -> Set it up (the enrolment body in place)
//   password  their password is older than the org's maximum age
//             -> Change password (the Change password dialog in place)
//
// 400px, no close button, not dismissable by Esc or outside click; one
// primary and a Log out link, so a person is never trapped behind a dimmed
// app with no way out. It closes only when the hold clears. Until Workspace
// settings > Security writes a rule, `hold` is always null and nothing here
// ever renders (the correct behaviour, not a stub).

import { useState } from "react";
import { signOut } from "next-auth/react";
import { apiFetch } from "@/lib/api-client";
import { clearAllPerformanceDrafts } from "@/lib/people/draft-keys";
import { ORG_ROLE_LABEL } from "@/lib/access/labels";
import type { OrgRole } from "@/lib/access/types";
import type { PasswordPolicyView } from "@/lib/auth/password-rules";
import type { SecurityHold } from "@/lib/auth/security-policy";
import { AccountDialog, btn } from "./account-ui";
import { MfaEnrolPanel } from "./mfa-enrol-panel";
import { ChangePasswordDialog } from "./change-password-dialog";

export function SecurityHoldDialog({
  hold,
  role,
  orgName,
  who,
  maxAgeDays,
}: {
  hold: SecurityHold;
  role: OrgRole;
  orgName: string;
  who: string;
  maxAgeDays?: number | null;
}) {
  const [cleared, setCleared] = useState(false);
  const [inner, setInner] = useState(false);
  const [policy, setPolicy] = useState<PasswordPolicyView | null>(null);
  const [offline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);

  if (!hold || cleared) return null;

  const logOut = () => { clearAllPerformanceDrafts(); void signOut({ callbackUrl: "/login" }); };
  const roleWord = ORG_ROLE_LABEL[role]?.toLowerCase() ?? "member";

  const openPassword = async () => {
    // The dialog prints the org's own rules; read them fresh.
    const r = await apiFetch<{ user?: { policy?: { password?: PasswordPolicyView } } }>("/api/me", { cache: "no-store" });
    setPolicy(r.ok && r.data?.user?.policy?.password ? r.data.user.policy.password : { minLength: 8, requireUppercase: true, requireNumbers: true });
    setInner(true);
  };

  if (hold === "mfa") {
    return (
      <AccountDialog
        open
        onOpenChange={() => {}}
        dismissable={false}
        title="Set up two step verification"
        width={inner ? 560 : 400}
        footer={inner ? undefined : (
          <>
            <button type="button" className={btn.ghost} onClick={logOut}>Log out</button>
            <button type="button" className={btn.primary} onClick={() => setInner(true)} disabled={offline} autoFocus>Set it up</button>
          </>
        )}
      >
        {inner ? (
          <MfaEnrolPanel
            source={{ kind: "session" }}
            who={who}
            onCancel={() => setInner(false)}
            onFinished={() => setCleared(true)}
          />
        ) : (
          <>
            <p className="text-base text-ink">{orgName} now requires it for {roleWord}s. It takes a minute.</p>
            {offline ? <p className="text-sm text-ink-2">You are offline</p> : null}
          </>
        )}
      </AccountDialog>
    );
  }

  return (
    <>
      <AccountDialog
        open={!inner}
        onOpenChange={() => {}}
        dismissable={false}
        title="Time to change your password"
        width={400}
        footer={
          <>
            <button type="button" className={btn.ghost} onClick={logOut}>Log out</button>
            <button type="button" className={btn.primary} onClick={() => { void openPassword(); }} disabled={offline} autoFocus>Change password</button>
          </>
        }
      >
        <p className="text-base text-ink">
          {maxAgeDays ? `${orgName} asks everyone to change their password every ${maxAgeDays} days.` : `${orgName} asks you to change your password now.`}
        </p>
        {offline ? <p className="text-sm text-ink-2">You are offline</p> : null}
      </AccountDialog>
      {inner && policy ? (
        <ChangePasswordDialog
          open
          dismissable={false}
          policy={policy}
          onOpenChange={(v) => { if (!v) setInner(false); }}
          onChanged={() => setCleared(true)}
        />
      ) : null}
    </>
  );
}
