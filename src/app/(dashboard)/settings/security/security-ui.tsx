"use client";

// Workspace settings > Security's shared pieces (settings-cleanup Phase 7):
// the copy each card shows, the check that decides which confirm a two step
// save asks, and the SCIM endpoint card's body over the read it shows. The
// page keeps every read, save and confirm; these hold no read of their own,
// so each is tested over the states it draws.

import { Copy } from "lucide-react";
import { ErrorState } from "@/components/ui/error-state";
import { btn } from "@/components/settings/settings-form";
import type { SignInPolicy } from "@/lib/settings/org-policy";

/**
 * Log everyone out's hint, its consequence on one line beside the button (B5):
 * every session, every device, within five minutes, the person pressing it
 * included. The confirm repeats that everyone logs in again.
 */
export const LOG_OUT_EVERYONE_HINT = "Every session on every device ends within five minutes, yours included.";

/**
 * The toast once everyone is logged out, one person or many (final Settings
 * review, M8: it read "1 people will sign in again").
 */
export function loggedOutLine(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"} logged out. They log in again on their next click.`;
}

/**
 * Invitation domains: the card's description says what the list controls,
 * and the row's one line what it never does (Phase 7 review, L5: the two
 * were the other way round, so the description read as a fragment).
 */
export const INVITE_DOMAINS_DESCRIPTION = "Invitations, and new accounts from your identity provider, must use one of these domains.";
// The domain governs invitations, never logging in (final Settings review, M11).
export const INVITE_DOMAINS_HINT = "People already here log in whatever their domain.";

/**
 * How provisioning works: what happens to people, shown (B6: a card
 * description of at most two lines), and the rules about roles, domains and
 * the last Owner behind Show more.
 */
export const PROVISIONING_LINE =
  "People created by your identity provider arrive as Members. Removing someone there deactivates them here and hands what they owned to their manager, else to an Owner.";
export const PROVISIONING_MORE = [
  "Owner, Admin and Agent are set here, never by the provider.",
  "An address outside your allowed domains is refused.",
  "The last Owner is never removed that way.",
] as const;

/** Single sign-on, under Show upcoming features: the Passwords card's last line. */
export const SSO_UPCOMING = "Coming soon: single sign-on with SAML and OIDC, once logging in with it is verified end to end.";

type MfaSummary = { mfa?: { viewerEnrolled?: boolean } | null };

/**
 * Which confirm a save asks before it raises two step verification over
 * people who may not have set it up (pure; tested):
 *
 *   none          nothing raised, or the saver has set it up
 *   notEnrolled   the saver is covered and has not set it up
 *   unknown       the saver is covered and the check could not be read: the
 *                 save still asks, with that said, rather than skipping the
 *                 question (a failed read used to look like "set up", so an
 *                 Admin who had not would be held at their next check with
 *                 no warning)
 */
export function mfaConfirmKind(draft: SignInPolicy | null, base: SignInPolicy | null, summary: MfaSummary | null): "none" | "notEnrolled" | "unknown" {
  if (!draft || !base) return "none";
  if (draft.mfaRequired === base.mfaRequired || draft.mfaRequired === "off") return "none";
  // No counts, or an answer without them, is a check that could not be made.
  if (!summary?.mfa || typeof summary.mfa.viewerEnrolled !== "boolean") return "unknown";
  return summary.mfa.viewerEnrolled ? "none" : "notEnrolled";
}

/** The two confirms' words. Both offer Set it up now and Save anyway. */
export const MFA_CONFIRM_COPY = {
  notEnrolled: {
    title: "You have not set up two step verification",
    body: "This rule covers you. Within five minutes you will be asked to set it up before you can do anything else, so have your phone ready.",
  },
  unknown: {
    title: "Couldn't check your two step verification",
    body: "This rule covers you. If you have not set it up, within five minutes you will be asked to before you can do anything else, so have your phone ready.",
  },
} as const;

/**
 * The SCIM endpoint card's body: the address with its Copy button once it is
 * read, the compact ErrorState with Try again when the read failed (it used
 * to leave an empty box with a greyed Copy and no word why), and the empty
 * box at its own height while the read is out, so nothing moves.
 */
export function ScimEndpoint({ url, failed, onRetry, onCopy }: { url: string | null; failed: boolean; onRetry: () => void; onCopy: (url: string) => void }) {
  if (failed && !url) return <ErrorState compact what="the SCIM address" onRetry={onRetry} />;
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-hover px-3 py-2 font-mono text-sm">{url ?? " "}</code>
      <button type="button" className={btn.secondary} disabled={!url} onClick={() => { if (url) onCopy(url); }}>
        <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy
      </button>
    </div>
  );
}
