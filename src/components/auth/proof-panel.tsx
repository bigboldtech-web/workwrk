// AuthProofPanel (spec-account-auth section 3): the navy right column above
// 1024px. Two variants:
//   proof       only claims that are true of the product today: no
//               testimonial, no logo wall, no "18 locales", no "SSO" (there
//               is no SSO button yet), no invented numbers (B29).
//   invitation  the /join panel: the org, and the real facts the invitation
//               carries. Only facts that exist render; a Guest invitation
//               shows the object and the role on it instead of employment
//               facts (department, manager) a Guest does not have.
// Server-safe: no hooks; /join passes the facts it fetched.

import { Check, Folder } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export interface InvitationFacts {
  organizationName: string;
  organizationLogo?: string | null;
  orgRole?: "ADMIN" | "MEMBER" | "GUEST";
  roleLabel?: string | null;
  inviterName?: string | null;
  departmentName?: string | null;
  managerName?: string | null;
  message?: string | null;
  object?: { kind: string; name: string; url: string; containerName: string | null } | null;
  objectRole?: string | null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "W";
}

const PROOF_LINES = [
  "Lists, docs, tables and forms that link to each other",
  "Goals, reviews and SOPs tied to the work itself",
  "Two step verification and an audit log in every workspace",
];

export function AuthProofPanel({ variant = "proof", invitation, loading = false }: { variant?: "proof" | "invitation"; invitation?: InvitationFacts | null; loading?: boolean }) {
  if (variant === "invitation") {
    if (loading || !invitation) {
      return (
        <aside className="wa-panel" aria-hidden>
          <div className="wa-panel__inner">
            <div className="wa-panel__skel" style={{ width: 180, height: 22 }} />
            <div className="wa-panel__skel" style={{ width: 240 }} />
          </div>
        </aside>
      );
    }
    const guest = invitation.orgRole === "GUEST";
    const facts: string[] = [];
    if (invitation.inviterName) facts.push(`Invited by ${invitation.inviterName}`);
    if (!guest && invitation.roleLabel) facts.push(`As a ${invitation.roleLabel}`);
    if (!guest && invitation.departmentName) facts.push(`In ${invitation.departmentName}`);
    if (!guest && invitation.managerName) facts.push(`Reporting to ${invitation.managerName}`);
    return (
      <aside className="wa-panel" aria-label="Your invitation">
        <div className="wa-panel__inner">
          <div className="wa-panel__org">
            <span className="wa-panel__tile">
              {invitation.organizationLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={invitation.organizationLogo} alt="" />
              ) : (
                initials(invitation.organizationName)
              )}
            </span>
            <h2>{invitation.organizationName}</h2>
          </div>
          {facts.length > 0 ? (
            <ul className="wa-panel__list">
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
          {invitation.object ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="wa-panel__object">
                <span className="wa-panel__tile wa-panel__tile--sm">
                  <Folder size={12} aria-hidden />
                </span>
                {invitation.object.name}
              </span>
              {invitation.objectRole ? (
                <span className="wa-panel__lead" style={{ fontSize: 14 }}>
                  You will have <strong style={{ color: "var(--os-chrome-fg)", fontWeight: 600 }}>{invitation.objectRole}</strong> on it
                </span>
              ) : null}
              {invitation.object.containerName ? <span className="wa-panel__lead" style={{ fontSize: 13 }}>Inside {invitation.object.containerName}</span> : null}
            </div>
          ) : null}
          {invitation.message ? <blockquote className="wa-panel__quote">{invitation.message}</blockquote> : null}
        </div>
      </aside>
    );
  }

  return (
    <aside className="wa-panel" aria-label="About WorkwrK">
      <div className="wa-panel__inner">
        <Logo width={28} />
        <h2 className="wa-panel__title">The work and the people doing it, in one place.</h2>
        <ul className="wa-panel__list">
          {PROOF_LINES.map((line) => (
            <li key={line}>
              <Check size={16} aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
