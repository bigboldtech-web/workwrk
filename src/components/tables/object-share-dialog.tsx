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
//
// PublicLinkSection, at the end of this file, is the public link on its own:
// the one Manage access dialog composes it for a table and a form
// (src/components/access/general-access.tsx). The older dialog this header
// describes was removed (pen test 2026-11-28, V-30, the step 7 review): it was
// mounted nowhere and built a table's public link from the bare id.

import { useState } from "react";
import { Copy, Globe, Link2, Lock, RotateCcw } from "lucide-react";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { objectHref } from "@/lib/nav/object-href";
import { copyObjectLink, hubNow } from "@/components/layout/os/use-object-href";
import { Dots } from "@/components/ui/dots";
import { InlineRetry } from "@/components/layout/os/share-space-dialog";

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
export function objectLink(kind: "table" | "form", id: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (kind === "form") return `${origin}/forms/${id}/respond`;
  // A table's PUBLIC address is signed (pen test V-30) and comes only from the
  // server (the access panel's publicLink.url); nothing builds it from the id.
  return `${origin}${objectHref("table", id, hubNow())}`;
}

// The older ObjectShareDialog lived here, mounted nowhere since the shared
// ShareDialog took over, and it built a table's public link from the bare id
// (pen test 2026-11-28, V-30, the step 7 review): removed.

/**
 * A table's or a form's public link, from the Manage access panel
 * (AccessPanel.general.publicLink). Exactly two values, Off and "Anyone with
 * the link can view" (toggle 10), changed only by Full access, and turning it
 * on asks first and names what becomes visible. Under it, when on: Copy
 * public link, the embed code and Copy internal link. A form always keeps
 * "Copy the form's link", the responder its people answer through.
 *
 * `publicLink` null means the workspace does not allow public links and this
 * one is off: the row does not exist. A link left on after the workspace
 * switched them off says so, and Full access can still turn it off.
 */
export function PublicLinkSection({
  kind, id, name, publicLink, canChange, orgName, onChanged,
}: {
  kind: "table" | "form";
  id: string;
  name: string;
  publicLink: { on: boolean; allowed: boolean; url: string | null } | null;
  canChange: boolean;
  orgName: string;
  /** After the server agreed; the dialog refetches its panel. */
  onChanged?: (isPublic: boolean) => void;
}) {
  const confirm = useConfirm();
  const { toast } = useOsToast();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ message: string; next: boolean } | null>(null);
  const noun = kind === "table" ? "table" : "form";
  const title = name || (kind === "table" ? "Untitled table" : "Untitled form");
  const on = !!publicLink?.on;
  // A table's public address is its id AND a signature (pen test V-30): the
  // panel names it to the people who manage the link; nothing here rebuilds it
  // from the id, which no longer opens.
  const tableRef = kind === "table" && publicLink?.url?.startsWith("/embed/tables/") ? publicLink.url.slice("/embed/tables/".length) : null;
  const linkKnown = kind === "form" || !!tableRef;

  /** A new public link for a table, every older one ended. */
  async function resetLink() {
    if (busy) return;
    const ok = await confirm({
      title: "Reset the public link?",
      description: `The current link to "${title}" will stop working, for everyone who has it, and its embeds will go blank. You get a new link to share.`,
      confirmLabel: "Reset link",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const r = await apiFetch(`/api/tables/${id}`, { method: "PATCH", json: { resetPublicLink: true } });
    setBusy(false);
    if (!r.ok) {
      toast(r.error || "Couldn't reset the link.", { tone: "danger" });
      return;
    }
    toast("New public link made. The old one no longer opens.");
    onChanged?.(true);
  }

  async function setPublic(next: boolean, confirmed = false) {
    if (busy || next === on) return;
    if (next && !confirmed) {
      const ok = await confirm({
        title: "Turn on the public link?",
        description: kind === "table"
          ? `Anyone with the link will be able to see every row and column of "${title}", without signing in. You can turn it off again at any time.`
          : `Anyone with the link will be able to open and read "${title}". Only people at ${orgName} can send answers, after they sign in. You can turn it off again at any time.`,
        confirmLabel: "Turn on",
      });
      if (!ok) return;
    }
    setBusy(true);
    setFailed(null);
    const r = await apiFetch(`/api/${kind === "table" ? "tables" : "forms"}/${id}`, { method: "PATCH", json: { isPublic: next } });
    setBusy(false);
    if (!r.ok) {
      setFailed({ message: r.status === 403 && r.error ? r.error : "Couldn't change the public link.", next });
      return;
    }
    toast(next ? "Public link is on" : "Public link is off");
    onChanged?.(next);
  }

  function copy(text: string, done: string) {
    void navigator.clipboard?.writeText(text).then(() => toast(done), () => toast("Couldn't copy", { tone: "danger" }));
  }

  const formLink = kind === "form" ? (
    <button type="button" onClick={() => copy(objectLink("form", id), "Link copied")} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
      <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy the form&apos;s link
    </button>
  ) : null;

  if (!publicLink) return formLink ? <div className="flex flex-wrap gap-1">{formLink}</div> : null;

  if (!publicLink.allowed) {
    if (!on) return formLink ? <div className="flex flex-wrap gap-1">{formLink}</div> : null;
    return (
      <div className="flex flex-col gap-2">
        <p className="m-0 text-sm text-ink-2">Public links are off for this workspace, so this {noun}&apos;s link does not open.</p>
        {canChange ? (
          <div>
            <button type="button" onClick={() => void setPublic(false)} className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-sm font-medium text-ink hover:bg-hover">
              {busy ? <Dots variant="pending" /> : <Lock className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Turn the link off
            </button>
          </div>
        ) : null}
        {failed ? <InlineRetry message={failed.message} onRetry={() => void setPublic(failed.next, true)} /> : null}
        {formLink ? <div className="flex flex-wrap gap-1">{formLink}</div> : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-active text-ink-2">
          {on ? <Globe className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : <Lock className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
        </span>
        {canChange ? (
          <select
            aria-label="Public link"
            value={on ? "view" : "off"}
            onChange={(e) => void setPublic(e.target.value === "view")}
            aria-busy={busy || undefined}
            className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-base text-ink focus:outline-none focus-visible:border-brand"
          >
            <option value="off">Off</option>
            <option value="view">Anyone with the link can view</option>
          </select>
        ) : (
          <span className="text-base text-ink">{on ? "Anyone with the link can view" : "Off"}</span>
        )}
        {busy ? <Dots variant="pending" /> : null}
      </div>
      {kind === "form" ? <p className="m-0 text-sm text-ink-2">Only people at {orgName} can send answers, after they sign in.</p> : null}
      {!canChange ? <p className="m-0 text-sm text-ink-2">Only people with Full access can change its public link.</p> : null}
      {failed ? <InlineRetry message={failed.message} onRetry={() => void setPublic(failed.next, true)} /> : null}
      {on && linkKnown ? (
        <div className="flex min-w-0 flex-col gap-2 pt-1">
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => copy(publicLink.url ? absolute(publicLink.url) : objectLink(kind, id), "Public link copied")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 text-sm font-medium text-ink hover:bg-hover">
              <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy public link
            </button>
            <button type="button" onClick={() => copy(embedSnippet(kind, tableRef ?? id, title), "Embed code copied")} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
              <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy embed code
            </button>
            <button type="button" onClick={() => copy(copyObjectLink(kind, id), "Internal link copied")} title={`Opens it for people signed in to ${orgName}`} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
              <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy internal link
            </button>
          </div>
          {kind === "table" && canChange ? (
            <div>
              <button type="button" disabled={busy} onClick={() => void resetLink()} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50">
                <RotateCcw className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Reset link
              </button>
            </div>
          ) : null}
          <code className="block overflow-x-auto whitespace-pre rounded-md border border-line bg-subtle px-3 py-2 font-mono text-xs text-ink-2">{embedSnippet(kind, tableRef ?? id, title)}</code>
        </div>
      ) : on ? (
        // The public address is for the people who manage the link; everyone
        // else still copies the internal one (the final review).
        <div className="flex flex-wrap gap-1 pt-1">
          <button type="button" onClick={() => copy(copyObjectLink(kind, id), "Internal link copied")} title={`Opens it for people signed in to ${orgName}`} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
            <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy internal link
          </button>
        </div>
      ) : null}
      {formLink ? <div className="flex flex-wrap gap-1">{formLink}</div> : null}
    </div>
  );
}

function absolute(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}
