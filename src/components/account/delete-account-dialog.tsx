"use client";

// Delete my account (spec-account-auth): 400px, typed confirmation. The last
// Owner or Admin case is a refusal shown BEFORE the field, and the field does
// not render at all then (the server refuses it too: /api/me/delete answers
// 409 last_admin). On success the session ends and /login says so.

import Link from "next/link";
import { useState } from "react";
import { signOut } from "next-auth/react";
import { apiFetch } from "@/lib/api-client";
import { clearAllPerformanceDrafts } from "@/lib/people/draft-keys";
import { AccountDialog, btn, DialogBanner, FieldLabel, Pending, TextInput } from "./account-ui";
import { DELETE_CONFIRM_WORD, deleteConfirmed } from "@/lib/account/profile-form";


export function DeleteAccountDialog({
  open,
  onOpenChange,
  isLastOwner,
  orgName,
  canOpenMembers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isLastOwner: boolean;
  orgName: string;
  canOpenMembers: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastAdmin, setLastAdmin] = useState(false);
  const refused = isLastOwner || lastAdmin;

  const close = (v: boolean) => {
    if (busy) return;
    if (!v) { setTyped(""); setErr(null); }
    onOpenChange(v);
  };

  const go = async () => {
    if (busy || !deleteConfirmed(typed)) return;
    setBusy(true);
    setErr(null);
    const r = await apiFetch("/api/me/delete", { method: "POST", json: { confirm: DELETE_CONFIRM_WORD } });
    if (!r.ok) {
      setBusy(false);
      if (r.status === 409 || r.code === "last_admin") setLastAdmin(true);
      else setErr(r.error || "Couldn't delete your account. Try again.");
      return;
    }
    clearAllPerformanceDrafts();
    await signOut({ callbackUrl: "/login?deleted=1" });
  };

  return (
    <AccountDialog
      open={open}
      onOpenChange={close}
      title="Delete my account"
      width={400}
      footer={
        refused ? (
          <button type="button" className={btn.ghost} onClick={() => close(false)}>Close</button>
        ) : (
          <>
            <button type="button" className={btn.ghost} onClick={() => close(false)} disabled={busy}>Cancel</button>
            <button type="button" className={btn.danger} onClick={() => { void go(); }} disabled={busy || !deleteConfirmed(typed)}>
              {busy ? <Pending label="Deleting" /> : null}
              Delete my account
            </button>
          </>
        )
      }
    >
      {refused ? (
        <div className="rounded-md border border-[var(--os-danger-border)] p-3 text-base text-ink">
          You are the only admin of {orgName}. Make someone else an admin first, or delete the workspace from Workspace settings.
          {canOpenMembers ? (
            <div className="mt-2">
              <Link href="/settings/members" className={btn.link}>Open Members</Link>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="rounded-md border border-[var(--os-danger-border)] p-3 text-base text-ink">
            This deletes your account in every workspace you belong to, not only {orgName}. Your name, email, photo, phone and date of birth are erased, and your notifications are deleted. Your AI chats, the requests AI teammates asked you to approve and what they remember about you are erased, and your routines stop. Tasks, docs and messages you created stay with their workspace, shown as from a deleted user, and so does the record of what you did there, without your network details.
          </div>
          <DialogBanner>{err}</DialogBanner>
          <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
            <FieldLabel htmlFor="delete-confirm">Type DELETE to confirm</FieldLabel>
            <TextInput id="delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} autoFocus />
          </form>
        </>
      )}
    </AccountDialog>
  );
}
