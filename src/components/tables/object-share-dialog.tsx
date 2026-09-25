"use client";

// The Share dialog for a Table or a Form (spec-tables-forms section 3 ask 1,
// access 6.1), until the one ShareDialog (src/components/access/share-dialog)
// grows table and form flavours and a grants store to write to. It is the
// interim the spec names: "the existing isPublic PATCH is locked to Full
// access holders and put behind a confirm in place". What it shows:
//
//   Who has access   the truth today, in the access model's words: a table in
//                    a Space inherits the Space; a standalone table is
//                    everyone at the org at Can edit; a form's access comes
//                    from where it sends answers ("Access to {form} comes
//                    from {anchor}"). The maker and admins hold Full access.
//   Public link      exactly two values, "Off" and "Anyone with the link can
//                    view" (toggle 10 has two values, invariant 19). Rendered
//                    only when the org allows public links. Only Full access
//                    (the maker or an admin) changes it; turning it on asks
//                    first and names what becomes visible; the server writes
//                    the audit row. Under it, when on: Copy public link
//                    and the embed code in a copyable block.
//
// A viewer who cannot share opens the same dialog read-only ("who" mode): the
// role chip on the title row opens it.

import { useState } from "react";
import { Check, Copy, Globe, Link2, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { apiFetch } from "@/lib/api-fetch";
import { objectHref } from "@/lib/nav/object-href";
import { hubNow } from "@/components/layout/os/use-object-href";

export interface ShareObject {
  kind: "table" | "form";
  id: string;
  name: string;
  isPublic: boolean;
  /** Creator or Owner/Admin: holds Full access, may change the public link. */
  canManage: boolean;
  /** Toggle 10: false = the Public link row does not exist. */
  publicLinksAllowed: boolean;
  /** Table: its Space's name. Form: the List or Table it sends answers to. */
  anchorName?: string | null;
  ownerName?: string | null;
}

export function embedSnippet(kind: "table" | "form", id: string, name: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const src = `${origin}/embed/${kind === "table" ? "tables" : "forms"}/${id}`;
  const height = kind === "table" ? 500 : 640;
  return `<iframe src="${src}" width="100%" height="${height}" style="border:0" title="${(name || "").replace(/"/g, "&quot;")}"></iframe>`;
}

/**
 * The link a person can open: the sheet itself, or the form's responder.
 * The sheet's internal link is the share form of the section it is copied
 * from, read at the moment of the copy: the Work door from Work (so the
 * recipient stays in Work, and no Space's slug reaches a clipboard), the
 * canonical /tables/<id> everywhere else. The public embed link and the
 * form's responder are public addresses and never change.
 */
export function objectLink(kind: "table" | "form", id: string, publicLink = false): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (kind === "form") return `${origin}/forms/${id}/respond`;
  return publicLink ? `${origin}/embed/tables/${id}` : `${origin}${objectHref("table", id, hubNow())}`;
}

export function ObjectShareDialog({
  open, onClose, object, mode, onPublicChange,
}: {
  open: boolean;
  onClose: () => void;
  object: ShareObject;
  mode: "share" | "who";
  /** Called after the server agreed to a public-link change. */
  onPublicChange?: (isPublic: boolean) => void;
}) {
  const { boot } = useBoot();
  const confirm = useConfirm();
  const { toast } = useOsToast();
  const [busy, setBusy] = useState(false);
  const [isPublic, setIsPublic] = useState(object.isPublic);
  // Adopt a changed prop during render (never in an effect).
  const [seen, setSeen] = useState(object.isPublic);
  if (seen !== object.isPublic) { setSeen(object.isPublic); setIsPublic(object.isPublic); }

  const noun = object.kind === "table" ? "table" : "form";
  const title = object.name || (object.kind === "table" ? "Untitled table" : "Untitled form");
  const orgName = boot.org.name || "your workspace";
  const canChange = mode === "share" && object.canManage;

  const whoLine = object.kind === "table"
    ? object.anchorName
      ? `Everyone who can open ${object.anchorName} can open and edit this table.`
      : `Everyone at ${orgName} can open and edit this table.`
    : object.anchorName
      ? `Access to ${title} comes from ${object.anchorName}: its editors can edit this form and read its responses.`
      : `Everyone at ${orgName} can open this form. Until it sends answers somewhere, its responses are read by the person who made it and admins.`;

  async function setPublic(next: boolean) {
    if (next === isPublic || busy) return;
    if (next) {
      const ok = await confirm({
        title: "Turn on the public link?",
        description: object.kind === "table"
          ? `Anyone with the link will be able to see every row and column of "${title}", without signing in. You can turn it off again at any time.`
          : `Anyone with the link will be able to open and read "${title}". Only people at ${orgName} can send answers, after they sign in. You can turn it off again at any time.`,
        confirmLabel: "Turn on",
      });
      if (!ok) return;
    }
    setBusy(true);
    const r = await apiFetch(`/api/${object.kind === "table" ? "tables" : "forms"}/${object.id}`, { method: "PATCH", json: { isPublic: next } });
    setBusy(false);
    if (!r.ok) { toast(r.status === 403 && r.error ? r.error : "Couldn't change the public link", { tone: "danger" }); return; }
    setIsPublic(next);
    onPublicChange?.(next);
    toast(next ? "Public link is on" : "Public link is off");
  }

  function copy(text: string, done: string) {
    void navigator.clipboard?.writeText(text).then(() => toast(done), () => toast("Couldn't copy", { tone: "danger" }));
  }

  // DialogContent is a grid with an implicit auto column, and an auto track
  // grows to its widest item's min-content. The embed code below is one
  // unbreakable whitespace-pre line, so without a zero minimum here the
  // track stretched to about 1200px: the dialog scrolled sideways, the
  // sentences were cut off and Done sat out of view. minmax(0,1fr) holds
  // the track to the dialog's width and the code block scrolls in its box.
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="os-chrome max-w-[560px] grid-cols-[minmax(0,1fr)] border-line bg-raised p-0 gap-0">
        <div className="flex h-14 items-center border-b border-line px-5">
          <DialogTitle className="truncate text-lg font-semibold text-ink">{mode === "share" ? `Share ${title}` : `Who has access to ${title}`}</DialogTitle>
        </div>
        <DialogDescription className="sr-only">Who can open this {noun}, and its public link.</DialogDescription>
        <div className="flex min-w-0 flex-col gap-5 px-5 py-4">
          <section className="flex flex-col gap-1.5">
            <h3 className="text-micro uppercase tracking-[0.06em] text-ink-2">People with access</h3>
            <p className="m-0 text-base text-ink">{whoLine}</p>
            <p className="m-0 text-sm text-ink-2">
              {object.ownerName ? `${object.ownerName} made it and holds Full access` : "The person who made it holds Full access"}, and so do the workspace&apos;s Owners and Admins.
            </p>
          </section>

          {object.publicLinksAllowed ? (
            <section className="flex min-w-0 flex-col gap-2">
              <h3 className="text-micro uppercase tracking-[0.06em] text-ink-2">Public link</h3>
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-2">
                  {isPublic ? <Globe className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : <Lock className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
                </span>
                {canChange ? (
                  <select
                    aria-label="Public link"
                    value={isPublic ? "view" : "off"}
                    disabled={busy}
                    onChange={(e) => void setPublic(e.target.value === "view")}
                    className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-base text-ink focus:outline-none focus-visible:border-brand"
                  >
                    <option value="off">Off</option>
                    <option value="view">Anyone with the link can view</option>
                  </select>
                ) : (
                  <span className="text-base text-ink">{isPublic ? "Anyone with the link can view" : "Off"}</span>
                )}
              </div>
              {object.kind === "form" ? <p className="m-0 text-sm text-ink-2">Only people at {orgName} can send answers, after they sign in.</p> : null}
              {!object.canManage && mode === "share" ? (
                <p className="m-0 text-sm text-ink-2">Only the person who made this, or an admin, can change its public link.</p>
              ) : null}
              {isPublic ? (
                <div className="flex min-w-0 flex-col gap-2 pt-1">
                  <div className="flex flex-wrap gap-2">
                    {/* "public" in the label: the footer has its own Copy
                        button for the signed-in link, and a table's two
                        links differ (/embed for outsiders, /tables inside). */}
                    <button type="button" onClick={() => copy(objectLink(object.kind, object.id, true), "Public link copied")} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover">
                      <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy public link
                    </button>
                    <button type="button" onClick={() => copy(embedSnippet(object.kind, object.id, title), "Embed code copied")} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">
                      <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy embed code
                    </button>
                  </div>
                  <code className="block overflow-x-auto whitespace-pre rounded-md border border-line bg-[var(--os-surface-1)] px-3 py-2 font-mono text-xs text-ink-2">{embedSnippet(object.kind, object.id, title)}</code>
                </div>
              ) : null}
            </section>
          ) : isPublic ? (
            // The workspace switched public links Off after this one was
            // turned on: the link no longer opens, and the owner can still
            // clear the stale flag here (the PATCH allows turning it off).
            <section className="flex flex-col gap-2">
              <h3 className="text-micro uppercase tracking-[0.06em] text-ink-2">Public link</h3>
              <p className="m-0 text-sm text-ink-2">Public links are off for this workspace, so this {noun}&apos;s link does not open.</p>
              {canChange ? (
                <div>
                  <button type="button" disabled={busy} onClick={() => void setPublic(false)} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover disabled:opacity-50">
                    <Lock className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Turn the link off
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => copy(objectLink(object.kind, object.id), object.kind === "form" ? "Link copied" : "Internal link copied")}
            title={object.kind === "form" ? undefined : `Opens the table for people signed in to ${orgName}`}
            className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink"
          >
            <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy {object.kind === "form" ? "the form's link" : "internal link"}
          </button>
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-base font-medium text-ink hover:bg-hover">
            <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
