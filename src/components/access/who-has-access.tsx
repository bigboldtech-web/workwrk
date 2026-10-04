"use client";

// Who has access: the read-only half of the one Manage access dialog, as
// list renderers over the AccessPanel (src/lib/access/access-panel.ts).
//
// It used to be a dialog of its own that fetched a container's /members
// route, which answered for a Space, a Folder and a List only and knew
// nothing of inherited reach, org-wide Spaces, admins or the older rule for
// Private items. It now renders exactly what the panel says, so the read-only
// view and the write view can never disagree about who is on the list: the
// dialog renders these same pieces around its controls.
//
// Nothing here writes. A "Manage in <name>" door appears only where the
// server says the viewer manages that ancestor, and it switches the dialog's
// target in place (the host decides what that means).

import type { ReactNode } from "react";
import { Globe, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/ui/avatar-stack";
import {
  panelRoleLabel, shareRoleLabel,
  type AccessDirectEntry, type AccessNodeKind, type AccessPanel, type AccessPerson, type ShareKind,
} from "@/lib/access/access-panel";
import {
  adminsLine, alsoViaText, capText, everyoneLine, groupInherited, hasOlderRule, inheritedHeader,
  LAST_FULL_TEXT, OLDER_RULE_FOOTNOTE,
} from "./manage-access-model";

export type ManageInTarget = { kind: ShareKind; id: string; name: string };

/** The one micro heading every section of the dialog carries. */
export function AccessSectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="m-0 mb-2 text-micro uppercase tracking-[0.06em] text-ink-2">{children}</h3>;
}

function avatarOf(p: AccessPerson) {
  const [firstName, ...rest] = p.name.split(" ");
  return { id: p.id, firstName: firstName || null, lastName: rest.join(" ") || null, avatar: p.avatar, email: p.email };
}

/**
 * One person: avatar, name, email and any quiet sub-lines, with whatever the
 * host puts at the end of the row (a role word, or the dialog's controls).
 */
export function AccessPersonRow({
  person, isYou = false, sub, children,
}: {
  person: AccessPerson;
  isYou?: boolean;
  /** Quiet second lines under the email: where else access comes from, a cap, the last Full holder. */
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex min-h-11 items-center gap-2.5 py-1.5">
      <Avatar person={avatarOf(person)} size={28} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-base text-ink">
          <span className="truncate">{person.name}</span>
          {isYou ? <span className="shrink-0 text-ink-3">(you)</span> : null}
          {!person.active ? <span className="shrink-0 rounded bg-active px-1.5 text-xs text-ink-2">Not active</span> : null}
        </span>
        <span className="block truncate text-xs text-ink-3">{person.email}</span>
        {sub}
      </span>
      {children ? <span className="flex shrink-0 items-center gap-1.5">{children}</span> : null}
    </li>
  );
}

/** The quiet lines under a direct row: another source, a cap from before, the last Full holder. */
export function DirectEntrySub({ entry, showLastFull }: { entry: AccessDirectEntry; showLastFull: boolean }) {
  const lines: string[] = [];
  if (entry.alsoVia) lines.push(alsoViaText(entry.alsoVia));
  if (entry.cap) lines.push(capText(entry));
  if (entry.note) lines.push(entry.note);
  if (showLastFull && entry.lastFull) lines.push(LAST_FULL_TEXT);
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((l) => (
        <span key={l} className="block text-xs text-ink-2">{l}</span>
      ))}
    </>
  );
}

/** The Owner chip: the person who made it, who always keeps Full access. */
export function OwnerChip() {
  return <span className="inline-flex h-6 items-center rounded-md bg-active px-2 text-xs font-medium text-ink">Owner</span>;
}

/** A role as a word, where the viewer cannot change it, in its kind's words (a goal's, a team's). */
export function RoleWord({ role, kind }: { role: AccessDirectEntry["role"]; kind?: ShareKind }) {
  return <span className="text-sm text-ink-2">{kind ? shareRoleLabel(kind, role) : panelRoleLabel(role)}</span>;
}

/** Everyone listed on the node itself, read only: the owner first, as the server orders them. */
export function DirectAccessList({ panel, meId }: { panel: AccessPanel; meId: string | null }) {
  if (panel.direct.length === 0) {
    return <p className="m-0 text-sm text-ink-2">Nobody has been added here directly.</p>;
  }
  return (
    <ul className="m-0 list-none divide-y divide-line-soft p-0">
      {panel.direct.map((e) => (
        <AccessPersonRow key={e.person.id} person={e.person} isYou={e.person.id === meId} sub={<DirectEntrySub entry={e} showLastFull={false} />}>
          {e.owner ? <OwnerChip /> : <RoleWord role={e.role} kind={panel.node.kind} />}
        </AccessPersonRow>
      ))}
    </ul>
  );
}

/**
 * People who reach the node from somewhere above it, grouped by where, in
 * the server's order. A container the viewer cannot open is never named.
 */
export function InheritedAccess({
  panel, meId, onManageIn,
}: {
  panel: AccessPanel;
  meId: string | null;
  onManageIn?: (target: ManageInTarget) => void;
}) {
  const groups = groupInherited(panel);
  const older = hasOlderRule(panel);
  if (groups.length === 0 && panel.hiddenInherited.length === 0 && !older) return null;
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => {
        const via = g.via;
        const door = via.type === "node" && via.canManage && onManageIn ? via : null;
        return (
          <div key={g.key}>
            <div className="mb-1 flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-2">{inheritedHeader(via)}</span>
              {door ? (
                <button
                  type="button"
                  onClick={() => onManageIn?.({ kind: door.kind, id: door.id, name: door.name })}
                  className="shrink-0 text-sm font-medium text-brand-deep hover:underline"
                >
                  Manage in {door.name}
                </button>
              ) : null}
            </div>
            {g.entries.length > 0 ? (
              <ul className="m-0 list-none divide-y divide-line-soft p-0">
                {g.entries.map((e) => (
                  <AccessPersonRow key={`${g.key}:${e.person.id}`} person={e.person} isYou={e.person.id === meId}>
                    <RoleWord role={e.role} kind={panel.node.kind} />
                  </AccessPersonRow>
                ))}
              </ul>
            ) : null}
            {g.more > 0 ? <p className="m-0 mt-1 text-sm text-ink-2">and {g.more} more</p> : null}
          </div>
        );
      })}
      {panel.hiddenInherited.map((h) => (
        <p key={`${h.kind}:${h.name}`} className="m-0 text-sm text-ink-2">People with access to {h.name} can also open this.</p>
      ))}
      {older ? <p className="m-0 text-xs text-ink-3">{OLDER_RULE_FOOTNOTE}</p> : null}
    </div>
  );
}

/** The two lines under the people: everyone at the org, and the org's admins. */
export function EveryoneAndAdmins({ panel }: { panel: AccessPanel }) {
  const everyone = everyoneLine(panel);
  const admins = adminsLine(panel);
  // The rules that decide access here and are no one's row (an SOP folder's,
  // a tool's, a goal's, a team's), as the server words them.
  const notes = panel.notes ?? [];
  if (!everyone && !admins && notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {everyone ? (
        <p className="m-0 flex items-start gap-2 text-sm text-ink">
          <Globe className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden /> <span className="min-w-0">{everyone}</span>
        </p>
      ) : null}
      {admins ? (
        <p className="m-0 flex items-start gap-2 text-sm text-ink-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden /> <span className="min-w-0">{admins}</span>
        </p>
      ) : null}
      {notes.map((note) => (
        <p key={note} className="m-0 flex items-start gap-2 text-sm text-ink-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden /> <span className="min-w-0">{note}</span>
        </p>
      ))}
    </div>
  );
}

/** The whole read-only list: listed here, from above, everyone and admins. */
export function WhoHasAccess({
  panel, meId, onManageIn,
}: {
  panel: AccessPanel;
  meId: string | null;
  onManageIn?: (target: ManageInTarget) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <AccessSectionHeading>People with access</AccessSectionHeading>
        <DirectAccessList panel={panel} meId={meId} />
      </section>
      <InheritedAccess panel={panel} meId={meId} onManageIn={onManageIn} />
      <EveryoneAndAdmins panel={panel} />
    </div>
  );
}
