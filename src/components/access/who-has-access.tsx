"use client";

// WhoHasAccess — the read-only half of the one Share door.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 1 row 8 ("for Can
// view and Can comment / Can edit without toggle 4 the row reads 'Who has
// access' and opens the dialog READ-ONLY") and the section 1 Access table,
// whose read-only column is a list with no controls.
//
// WHY A SEPARATE BODY. "Who has access" was a label swap and nothing else:
// `ShareButton` chose the wording from `canManage` and then handed both cases
// the identical write dialog, so a person told the surface was read-only was
// given the Restricted switch, the Add-people picker and a role select, none of
// which their role can commit. The access model's read-only rule is that the
// control is ABSENT, not disabled and not present-then-403, and the cheapest
// honest way to honour it across three dialogs of different shapes is one body
// that renders only what a reader may see.
//
// It asks the same members endpoint the write dialog does, so the two can never
// disagree about who is on the list, and it shows the role as a word rather
// than a select.

import { useCallback, useEffect, useState } from "react";
import { Globe, Lock, Users as UsersIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SkeletonLines } from "@/components/ui/skeleton";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import type { ShareTarget } from "./share-dialog";

interface MemberRow {
  role: string;
  user: { id: string; firstName: string | null; lastName: string | null; email: string; avatar: string | null };
}

const MEMBERS_PATH: Record<ShareTarget["kind"], string> = {
  space: "/api/spaces",
  folder: "/api/folders",
  list: "/api/boards",
};

/** The words the canon uses, never "Member"/"Guest" as raw enum values. */
const ROLE_WORD: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Full access",
  MEMBER: "Can edit",
  GUEST: "Can view",
};

function displayName(u: MemberRow["user"]): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email;
}

export function WhoHasAccess({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ShareTarget;
}) {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setMembers(null);
    try {
      const res = await fetch(`${MEMBERS_PATH[target.kind]}/${target.id}/members`, { cache: "no-store" });
      if (!res.ok) { setFailed(true); return; }
      const d = await res.json();
      setMembers(Array.isArray(d?.members) ? (d.members as MemberRow[]) : []);
    } catch {
      setFailed(true);
    }
  }, [target.id, target.kind]);

  // The fetch is kicked off a microtask after the effect, not inside it: the
  // reset it starts with is a setState, and doing that synchronously from an
  // effect cascades a render.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => { if (alive) void load(); }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [open, load]);

  const noun = target.kind === "space" ? "Space" : target.kind === "folder" ? "Folder" : "List";
  const restricted = target.visibility === "PRIVATE";
  const everyone = target.visibility === "ORG";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] p-0 gap-0">
        <div className="px-6 pt-6 pb-3">
          <DialogTitle className="text-lg font-semibold">Who has access to {target.name}</DialogTitle>
          <DialogDescription className="mt-1">
            You can read this {noun.toLowerCase()}. Ask someone with Full access to change who else can.
          </DialogDescription>
        </div>

        <div className="px-6 pb-4">
          <div className="flex items-start gap-2 rounded-lg border border-line bg-subtle px-3 py-2.5">
            {everyone ? (
              <Globe className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
            ) : restricted ? (
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
            ) : (
              <UsersIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
            )}
            <span className="min-w-0">
              <span className="block text-base font-medium text-ink">
                {everyone ? "Everyone in the org" : restricted ? "Restricted" : target.kind === "space" ? "Space members" : "Inherits from the Space"}
              </span>
              <span className="block text-sm text-ink-2">
                {everyone
                  ? `Every member of the organisation can open this ${noun.toLowerCase()}.`
                  : restricted
                    ? `Only the people below can open this ${noun.toLowerCase()}.`
                    : target.parentSpaceName
                      ? `Anyone who can open the Space ${target.parentSpaceName} can open this ${noun.toLowerCase()}.`
                      : `Anyone who can open the parent Space can open this ${noun.toLowerCase()}.`}
              </span>
            </span>
          </div>
        </div>

        <div className="border-t border-line-soft px-6 py-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">People with access</div>
          {members === null && !failed ? (
            <SkeletonLines lines={3} />
          ) : failed ? (
            <OsEmptyView
              variant="error"
              compact
              title="Couldn't load who has access"
              action={{ label: "Try again", onClick: () => void load() }}
            />
          ) : members === null || members.length === 0 ? (
            <p className="text-base text-ink-2">
              Nobody has been added directly. Access comes from the parent Space.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {members.map((m) => (
                <li key={m.user.id} className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-active text-xs font-semibold text-ink-2">
                    {(displayName(m.user) || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-ink">{displayName(m.user)}</span>
                    <span className="block truncate text-xs text-ink-3">{m.user.email}</span>
                  </span>
                  <span className="shrink-0 text-sm text-ink-2">{ROLE_WORD[m.role] ?? m.role}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* No Copy link here: the container "…" carries one for every viewer
            (spec section 1 row 5, "everyone"), and this body has no slug to
            build a URL from without a second prop that could go stale. */}
        <div className="flex items-center justify-end border-t border-line-soft px-6 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-md px-3 text-sm font-medium text-ink-2 hover:bg-hover"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
