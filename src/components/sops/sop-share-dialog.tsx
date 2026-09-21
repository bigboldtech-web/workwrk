"use client";

// SopShareDialog (spec-process section 1 "Sharing an unfiled SOP" and section
// 2 `/sops/[id]`): the Share door for a SOP, on the stores the product has
// today. Share always opens on SOMETHING:
//
//   filed      the folder's people, from GET /api/sop-folders/[id]/access
//              (the folder's access list is the SOP's sharing); "Manage in
//              Organize" for the people who can change it
//   unfiled    the "Everyone at {org}" row: an unfiled SOP is read by every
//              Member once published, which is what the Publish confirm says
//   public     the "Public link" row on this SOP (toggle 10): Copy link /
//              Turn off, through POST/DELETE /api/sops/[id]/share
//
// Opened read-only as "Who has access" for Can view / Can comment viewers
// (the role chip). The one AccessGrant dialog replaces this body when the
// access unit's step 5 lands; the button and the rows stay where they are.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe, Link2, Users } from "lucide-react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Dots } from "@/components/ui/dots";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { apiFetch } from "@/lib/api-fetch";
import { OBJECT_ROLE_LABEL } from "@/lib/access/labels";

type AccessRow = { user: PersonRef & { role?: { title?: string } | null; department?: { name?: string } | null }; role: "VIEWER" | "EDITOR" | "OWNER" };

const FOLDER_ROLE_LABEL: Record<AccessRow["role"], string> = { VIEWER: OBJECT_ROLE_LABEL.VIEW, EDITOR: OBJECT_ROLE_LABEL.EDIT, OWNER: OBJECT_ROLE_LABEL.FULL };

export function SopShareDialog({ open, onClose, mode, sop, onShareTokenChange }: {
  open: boolean;
  onClose: () => void;
  /** "share" = the write dialog; "who" = read-only "Who has access". */
  mode: "share" | "who";
  sop: { id: string; title: string; status: string; folderId: string | null; folderName: string | null; shareToken: string | null; ownerName: string | null; canManageFolder: boolean };
  onShareTokenChange?: (token: string | null) => void;
}) {
  const { toast } = useOsToast();
  const { boot } = useBoot();
  const confirm = useConfirm();
  const router = useRouter();
  const [rows, setRows] = useState<AccessRow[] | null | "hidden">(null);
  const [busy, setBusy] = useState<"mint" | "revoke" | null>(null);

  useEffect(() => {
    if (!open || !sop.folderId) return;
    let live = true;
    void (async () => {
      const r = await apiFetch<AccessRow[] | { data?: AccessRow[] }>(`/api/sop-folders/${sop.folderId}/access`, { cache: "no-store" });
      if (!live) return;
      if (!r.ok) { setRows("hidden"); return; }
      setRows(Array.isArray(r.data) ? r.data : r.data?.data ?? []);
    })();
    return () => { live = false; };
  }, [open, sop.folderId]);

  const publicUrl = sop.shareToken ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/sop/${sop.shareToken}` : null;

  async function copyPublic() {
    if (busy) return;
    if (sop.shareToken) {
      await navigator.clipboard.writeText(publicUrl!);
      toast("Public link copied");
      return;
    }
    setBusy("mint");
    const r = await apiFetch<{ shareToken?: string }>(`/api/sops/${sop.id}/share`, { method: "POST" });
    setBusy(null);
    if (!r.ok || !r.data?.shareToken) {
      // 409 = the workspace's Public links toggle is off. An admin gets the
      // door to the setting; everyone else gets the sentence that says who
      // can turn it on. Never a bare "Couldn't create".
      const isAdmin = boot.viewer.orgRole === "OWNER" || boot.viewer.orgRole === "ADMIN";
      if (!r.ok && r.status === 409 && isAdmin) {
        toast(r.error, { tone: "danger", action: { label: "Open Access settings", onClick: () => router.push("/settings/permissions") } });
        return;
      }
      toast(r.ok ? "Couldn't create a public link" : r.error || "Couldn't create a public link", { tone: "danger" });
      return;
    }
    onShareTokenChange?.(r.data.shareToken);
    await navigator.clipboard.writeText(`${window.location.origin}/share/sop/${r.data.shareToken}`);
    toast("Public link created and copied");
  }

  async function turnOff() {
    if (busy) return;
    const ok = await confirm({ title: "Turn off the public link?", description: "The link stops working right away. You can create a new one later.", confirmLabel: "Turn off", destructive: true });
    if (!ok) return;
    setBusy("revoke");
    const r = await apiFetch(`/api/sops/${sop.id}/share`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) { toast(r.error || "Couldn't turn off the link", { tone: "danger" }); return; }
    onShareTokenChange?.(null);
    toast("Public link turned off");
  }

  const readOnly = mode === "who";
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>{readOnly ? "Who has access" : "Share"}</DialogTitle>
        <DialogDescription>{sop.title || "Untitled SOP"}</DialogDescription>
        <div className="mt-2 flex w-full min-w-0 flex-col overflow-hidden">
          {sop.folderId ? (
            <>
              <div className="flex h-11 items-center gap-3 border-b border-line">
                <Users className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-base text-ink">This SOP follows <span className="font-medium">{sop.folderName ?? "its folder"}</span>&apos;s sharing</span>
                {!readOnly && sop.canManageFolder ? <Link href="/sops/manage?tab=sop-folders" className="shrink-0 text-sm font-medium text-brand-deep hover:underline">Manage in Organize</Link> : null}
              </div>
              {rows === null ? (
                <div className="py-2"><SkeletonRows rows={3} rowHeight="36px" /></div>
              ) : rows === "hidden" ? (
                <p className="py-3 text-sm text-ink-2">The folder&apos;s people are managed by admins{sop.ownerName ? ` and ${sop.ownerName}` : ""}.</p>
              ) : rows.length === 0 ? (
                <p className="py-3 text-sm text-ink-2">Admins only so far. Add people to the folder in Organize.</p>
              ) : (
                <ul className="max-h-64 overflow-y-auto">
                  {rows.map((r) => (
                    <li key={r.user.id} className="flex h-9 items-center gap-2 text-base text-ink">
                      <PersonAvatar person={r.user} size={24} />
                      <span className="min-w-0 flex-1 truncate">{`${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.trim() || r.user.email}</span>
                      <span className="shrink-0 text-xs font-medium text-ink-2">{FOLDER_ROLE_LABEL[r.role]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="flex min-h-11 items-center gap-3 border-b border-line py-2">
              <Users className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
              <span className="min-w-0 flex-1 text-base text-ink">
                Everyone at {boot.org.name}
                <span className="block text-sm text-ink-2">{sop.status === "PUBLISHED" ? "Every Member can read this SOP because it isn't in a folder." : "Once published, every Member will be able to read it, because it isn't in a folder. Move it into a folder to restrict it."}</span>
              </span>
            </div>
          )}
          <div className="flex min-h-11 w-full min-w-0 items-center gap-3 overflow-hidden py-2">
            <Globe className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
            <span className="block min-w-0 flex-1 overflow-hidden text-base text-ink">
              <span className="block truncate">Public link</span>
              <span className="block truncate text-sm text-ink-2" title={publicUrl ?? undefined}>
                {sop.shareToken ? publicUrl : sop.status === "PUBLISHED" ? "Anyone with the link can read it, signed in or not." : "Available once this SOP is published."}
              </span>
            </span>
            {readOnly ? (
              sop.shareToken ? <span className="shrink-0 text-xs font-medium text-ink-2">On</span> : <span className="shrink-0 text-xs font-medium text-ink-3">Off</span>
            ) : sop.status === "PUBLISHED" ? (
              <span className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => void copyPublic()} disabled={!!busy} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-brand-deep hover:bg-hover disabled:opacity-60">
                  {busy === "mint" ? <Dots variant="pending" /> : <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
                  {sop.shareToken ? "Copy link" : "Create link"}
                </button>
                {sop.shareToken ? (
                  <button type="button" onClick={() => void turnOff()} disabled={!!busy} className="inline-flex h-8 items-center rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60">Turn off</button>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
