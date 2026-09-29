"use client";

// Workspace settings > Security (sidebar-map 8a row 10). The canonical page
// exists from Stage A so /settings/security (and its ?tab= deep links) never
// 404s. Today it shows the workspace password rules that sign-up, invite
// acceptance, reset and change-password enforce (src/lib/password-policy.ts),
// read only, with an honest caption: the sign-in policy, single sign-on and
// provisioning editors land in S5, where each one is verified against an
// un-enrolled Admin and an enrolled Member before it is exposed. No control
// renders here without a handler.

import Link from "next/link";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettingsSection } from "@/hooks/use-settings-section";

type PasswordRules = { minPasswordLength: number; requireUppercase: boolean; requireNumbers: boolean };

export default function WorkspaceSecurityPage() {
  const rules = useSettingsSection<PasswordRules>("security", (body) => {
    const sec = (body.settings?.security ?? {}) as Partial<PasswordRules>;
    return {
      // The floor of 8 matches validatePassword, so the page never states a
      // weaker rule than the one enforced.
      minPasswordLength: Math.max(8, typeof sec.minPasswordLength === "number" ? sec.minPasswordLength : 8),
      // Unset means the built-in default, which requires both
      // (DEFAULT_PASSWORD_POLICY), exactly as policyFromOrgSettings reads it.
      requireUppercase: sec.requireUppercase ?? true,
      requireNumbers: sec.requireNumbers ?? true,
    };
  });

  return (
    <SettingsPage pageKey="security">
      <div className="space-y-6">
        <p className="max-w-[560px] text-base text-ink-2">
          The rules every password in this workspace must meet. Editing the sign-in policy,
          single sign-on and provisioning arrives here in a later release; until then these
          rules apply as shown.
        </p>

        <SettingsCard title="Password rules" description="Checked at sign-up, when an invitation is accepted, on reset and on change.">
          {rules.status === "error" ? (
            <ErrorState what="the password rules" onRetry={rules.retry} hint={rules.error ?? undefined} compact />
          ) : rules.status === "loading" || !rules.data ? (
            <div className="space-y-3" aria-busy="true" aria-label="Password rules">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : (
            <>
              <SettingsRow label="Minimum length" readOnlyValue={`${rules.data.minPasswordLength} characters`} />
              <SettingsRow label="Uppercase letter" readOnlyValue={rules.data.requireUppercase ? "Required" : "Not required"} />
              <SettingsRow label="Number" readOnlyValue={rules.data.requireNumbers ? "Required" : "Not required"} />
            </>
          )}
        </SettingsCard>

        <SettingsCard title="Your own sign-in" description="Your password, two-step verification and signed-in devices are personal.">
          <Link href="/account/security" className="text-base font-medium text-brand-deep hover:underline">
            Open My settings &rsaquo; Security
          </Link>
        </SettingsCard>
      </div>
    </SettingsPage>
  );
}
