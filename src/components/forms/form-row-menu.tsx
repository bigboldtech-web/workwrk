"use client";

// FormRowMenu (spec-tables-forms section 3): the ONE menu for a form, rendered
// by the /forms row "...", the Tables sidebar FORMS row "..." and the
// builder's title-row "...". Forms become deletable, duplicable, starrable and
// exportable from the interface for the first time (data.md 3.5, 2.3).
//
// Rows, in the spec's order, each rendered only when the viewer can use it:
//   Open · Open in new tab (not in the builder) · separator ·
//   Open the form (the responder) · Copy link · Copy embed code (public link
//   on) · separator · Rename (inline) · Duplicate · Add to / Remove from
//   favorites · separator · Share... · separator · Export responses as CSV
//   (never an Agent) · separator · Move to Trash (the maker or an admin;
//   confirm naming the form and its response count)

import { useEffect, useRef, useState, type RefObject } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, Code2, Copy, Download, ExternalLink, Link2, Pencil, Send, Share2, Star, Trash2 } from "lucide-react";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useBoot } from "@/components/layout/os/boot-context";
import { refreshSidebar } from "@/components/layout/os/sidebar-refresh";
import { apiFetch } from "@/lib/api-fetch";
import { downloadUrl } from "@/lib/download";
import { ObjectShareDialog, embedSnippet, objectLink } from "@/components/tables/object-share-dialog";

export interface FormMenuTarget {
  id: string;
  name: string;
  isFavorite?: boolean;
  isPublic?: boolean;
  canManage?: boolean;
  publicLinksAllowed?: boolean;
  responseCount?: number;
  /** The List or Table it sends answers to (the form's anchor). */
  destinationName?: string | null;
  ownerName?: string | null;
}

export type FormMenuChange = "renamed" | "duplicated" | "favorited" | "trashed" | "public";
export type FormMenuContext = "table" | "tree" | "builder";

/** Tell every list and sidebar that a form changed. */
export function dispatchFormsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("workwrk:forms-changed"));
  refreshSidebar();
}

export function FormRowMenu({
  form, context, onClose, onChanged, onShare, onRenameInline,
}: {
  form: FormMenuTarget;
  context: FormMenuContext;
  onClose: () => void;
  onChanged?: (kind: FormMenuChange, next?: Partial<FormMenuTarget>) => void;
  onShare?: (resolved: FormMenuTarget) => void;
  onRenameInline?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { boot } = useBoot();
  const [mode, setMode] = useState<"menu" | "rename">("menu");
  const [name, setName] = useState(form.name);
  const [fav, setFav] = useState(!!form.isFavorite);
  const [busy, setBusy] = useState<string | null>(null);

  const [resolved, setResolved] = useState<Partial<FormMenuTarget> | null>(null);
  const known = form.canManage !== undefined && form.isFavorite !== undefined;
  useEffect(() => {
    if (known) return;
    let alive = true;
    void (async () => {
      const [f, favs] = await Promise.all([
        apiFetch<{ canManage?: boolean; isPublic?: boolean; submissionCount?: number; publicLinksAllowed?: boolean }>(`/api/forms/${form.id}`, { cache: "no-store" }),
        form.isFavorite === undefined ? apiFetch<{ forms?: { id: string }[] }>("/api/me/favorites/forms", { cache: "no-store" }) : Promise.resolve(null),
      ]);
      if (!alive) return;
      setResolved({
        canManage: f.ok ? !!f.data.canManage : false,
        isPublic: f.ok ? !!f.data.isPublic : form.isPublic,
        responseCount: f.ok ? f.data.submissionCount ?? form.responseCount : form.responseCount,
        publicLinksAllowed: f.ok ? f.data.publicLinksAllowed !== false : true,
      });
      if (favs && favs.ok) setFav((favs.data.forms ?? []).some((x) => x.id === form.id));
    })();
    return () => { alive = false; };
  }, [known, form.id, form.isFavorite, form.isPublic, form.responseCount]);
  const canManage = form.canManage ?? resolved?.canManage ?? false;
  const isPublic = resolved?.isPublic ?? form.isPublic ?? false;
  const pending = !known && resolved === null;
  const isAgent = boot.viewer.isAgent;
  const title = form.name || "Untitled form";
  const full: FormMenuTarget = { ...form, ...(resolved ?? {}), isFavorite: fav, canManage };

  function copy(text: string, done: string) {
    void navigator.clipboard?.writeText(text).then(() => toast(done), () => toast("Couldn't copy", { tone: "danger" }));
    onClose();
  }

  async function rename() {
    const t = name.trim() || "Untitled form";
    if (t === form.name) { onClose(); return; }
    setBusy("rename");
    const r = await apiFetch(`/api/forms/${form.id}`, { method: "PATCH", json: { name: t } });
    setBusy(null);
    if (r.ok) { dispatchFormsChanged(); onChanged?.("renamed", { name: t }); } else toast(r.error || "Couldn't rename the form", { tone: "danger" });
    onClose();
  }

  async function duplicate() {
    setBusy("duplicate");
    const r = await apiFetch<{ id: string }>(`/api/forms/${form.id}/duplicate`, { method: "POST" });
    setBusy(null);
    onClose();
    if (!r.ok) { toast(r.error || "Couldn't copy the form", { tone: "danger" }); return; }
    dispatchFormsChanged();
    onChanged?.("duplicated");
    toast("Copy made", { action: { label: "Open", onClick: () => router.push(`/forms/${r.data.id}`) } });
  }

  async function toggleFav() {
    const next = !fav;
    setFav(next);
    const r = await apiFetch("/api/me/favorites/forms", { method: "POST", json: { formId: form.id, on: next } });
    if (r.ok) {
      window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
      onChanged?.("favorited", { isFavorite: next });
      toast(next ? "Added to favorites" : "Removed from favorites");
    } else { setFav(!next); toast("Couldn't update favorites", { tone: "danger" }); }
    onClose();
  }

  async function trash() {
    onClose();
    const n = full.responseCount ?? 0;
    const ok = await confirm({
      title: `Move "${title}" to Trash?`,
      description: n > 0
        ? `Its ${n.toLocaleString()} response${n === 1 ? "" : "s"} go with it. You can restore it from Trash for ${boot.org.trashDays} days.`
        : `You can restore it from Trash for ${boot.org.trashDays} days.`,
      destructive: true,
      confirmLabel: "Move to Trash",
    });
    if (!ok) return;
    const r = await apiFetch(`/api/forms/${form.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.status === 403 && r.error ? r.error : "Couldn't move the form to Trash", { tone: "danger" }); return; }
    toast("Moved to Trash", { action: { label: "View Trash", onClick: () => router.push("/trash?type=form") } });
    dispatchFormsChanged();
    onChanged?.("trashed");
    if (pathname === `/forms/${form.id}`) router.push("/forms");
  }

  if (mode === "rename") {
    return (
      <MenuList className="p-2" style={{ minWidth: 260 }}>
        <form onSubmit={(e) => { e.preventDefault(); void rename(); }} className="flex flex-col gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}
            onFocus={(e) => e.target.select()}
            placeholder="Untitled form"
            aria-label="Form name"
            className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand"
          />
          <div className="flex justify-end gap-1">
            <button type="button" onClick={onClose} className="h-8 rounded-md px-2.5 text-sm font-medium text-ink-2 hover:bg-hover">Cancel</button>
            <button type="submit" disabled={busy === "rename"} className="h-8 rounded-md bg-brand px-3 text-sm font-medium text-ink-inv hover:bg-brand-hover disabled:opacity-50">Rename</button>
          </div>
        </form>
      </MenuList>
    );
  }

  return (
    <MenuList style={{ minWidth: 240 }} aria-label={`Actions for ${title}`}>
      {context !== "builder" ? (
        <>
          <MenuItem icon={ClipboardList} label="Open" onClick={() => { router.push(`/forms/${form.id}`); onClose(); }} />
          <MenuItem icon={ExternalLink} label="Open in new tab" onClick={() => { window.open(`/forms/${form.id}`, "_blank", "noopener"); onClose(); }} />
          <MenuSeparator />
        </>
      ) : null}
      <MenuItem icon={Send} label="Open the form" onClick={() => { window.open(`/forms/${form.id}/respond`, "_blank", "noopener"); onClose(); }} />
      <MenuItem icon={Link2} label="Copy link" onClick={() => copy(objectLink("form", form.id), "Link copied")} />
      {isPublic && full.publicLinksAllowed !== false ? <MenuItem icon={Code2} label="Copy embed code" onClick={() => copy(embedSnippet("form", form.id, title), "Embed code copied")} /> : null}
      <MenuSeparator />
      <MenuItem icon={Pencil} label="Rename" onClick={() => { if (onRenameInline) { onClose(); onRenameInline(); } else { setName(form.name); setMode("rename"); } }} />
      <MenuItem icon={Copy} label="Duplicate" busy={busy === "duplicate"} onClick={() => void duplicate()} />
      <MenuItem icon={Star} iconFilled={fav} label={fav ? "Remove from favorites" : "Add to favorites"} onClick={() => void toggleFav()} />
      {onShare ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Share2} label="Share…" onClick={() => { onClose(); onShare(full); }} />
        </>
      ) : null}
      {!isAgent ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Download} label="Export responses as CSV" onClick={() => { downloadUrl(`/api/forms/${form.id}/responses/export.csv`); onClose(); }} />
        </>
      ) : null}
      {pending ? (
        <div className="flex flex-col gap-2 px-3 py-2" aria-busy="true" aria-label="Checking what you can do">
          {["60%", "45%"].map((w, i) => <span key={i} className="h-3 rounded bg-skeleton os-skeleton-pulse" style={{ width: w }} />)}
        </div>
      ) : null}
      {canManage && !isAgent ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Move to Trash" destructive onClick={() => void trash()} />
        </>
      ) : null}
    </MenuList>
  );
}

/* ───────────────────────── the host: point or anchor ───────────────────────── */

export interface FormRowMenuState {
  form: FormMenuTarget;
  point: { x: number; y: number } | null;
  anchor: RefObject<HTMLElement | null> | null;
}

export function useFormRowMenu() {
  const [state, setState] = useState<FormRowMenuState | null>(null);
  const open = (e: React.MouseEvent, form: FormMenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.type === "contextmenu" ? null : (e.currentTarget as HTMLElement | null);
    setState(el ? { form, point: null, anchor: { current: el } } : { form, point: { x: e.clientX, y: e.clientY }, anchor: null });
  };
  const openFrom = (anchor: RefObject<HTMLElement | null>, form: FormMenuTarget) => setState({ form, point: null, anchor });
  const close = () => setState(null);
  return { state, open, openFrom, close };
}

export function FormRowMenuHost({ menu, context, onChanged, onRenameInline }: {
  menu: ReturnType<typeof useFormRowMenu>;
  context: FormMenuContext;
  onChanged?: (kind: FormMenuChange, form: FormMenuTarget, next?: Partial<FormMenuTarget>) => void;
  onRenameInline?: () => void;
}) {
  const dummy = useRef<HTMLElement | null>(null);
  const [share, setShare] = useState<FormMenuTarget | null>(null);
  const s = menu.state;
  return (
    <>
      {s ? (
        <MorePortal anchorRef={s.anchor ?? dummy} width={260} open placement="below" point={s.point} onClose={menu.close}>
          <FormRowMenu
            key={s.form.id}
            form={s.form}
            context={context}
            onClose={menu.close}
            onChanged={(kind, next) => onChanged?.(kind, s.form, next)}
            onShare={(f) => setShare(f)}
            onRenameInline={onRenameInline}
          />
        </MorePortal>
      ) : null}
      {share ? (
        <ObjectShareDialog
          open
          mode={share.canManage ? "share" : "who"}
          onClose={() => setShare(null)}
          object={{
            kind: "form",
            id: share.id,
            name: share.name,
            isPublic: !!share.isPublic,
            canManage: !!share.canManage,
            publicLinksAllowed: share.publicLinksAllowed !== false,
            anchorName: share.destinationName ?? null,
            ownerName: share.ownerName ?? null,
          }}
          onPublicChange={(isPublic) => { onChanged?.("public", share, { isPublic }); dispatchFormsChanged(); }}
        />
      ) : null}
    </>
  );
}
