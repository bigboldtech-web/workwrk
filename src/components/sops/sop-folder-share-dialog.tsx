"use client";

// SopFolderShareDialog (spec-process section 2 `/sops/manage`, "Share…" on
// a SOP folder row, and the Share door on a filed SOP): the share dialog on
// the store the product has today, SOPFolderAccess, through
// GET/PATCH /api/sop-folders/[id]/access. Rows: the people with access and
// their role (Full access / Can edit / Can view, the access lib's words for
// OWNER / EDITOR / VIEWER), a picker to add someone, remove, one primary
// "Save". The AccessGrant flavour replaces the body when the access unit's
// step 5 lands; the row menu entry and the button stay where they are.
//
// "Nobody yet" is honest: a folder with no grants is visible to admins
// only, and this dialog is how it opens up.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, UserPlus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Dots } from "@/components/ui/dots";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { apiFetch } from "@/lib/api-fetch";
import { OBJECT_ROLE_LABEL } from "@/lib/access/labels";

type FolderRole = "VIEWER" | "EDITOR" | "OWNER";
const ROLE_LABEL: Record<FolderRole, string> = { OWNER: OBJECT_ROLE_LABEL.FULL, EDITOR: OBJECT_ROLE_LABEL.EDIT, VIEWER: OBJECT_ROLE_LABEL.VIEW };
const ROLES: FolderRole[] = ["OWNER", "EDITOR", "VIEWER"];
type AccessRow = { user: PersonRef; role: FolderRole };

function personName(p: PersonRef): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Unknown";
}

export function SopFolderShareDialog({ open, onClose, folder, onSaved }: {
  open: boolean;
  onClose: () => void;
  folder: { id: string; name: string } | null;
  onSaved?: () => void;
}) {
  const { toast } = useOsToast();
  const { boot } = useBoot();
  const [rows, setRows] = useState<AccessRow[] | null>(null);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [roleFor, setRoleFor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [seenKey, setSeenKey] = useState<string | null>(null);
  const key = open && folder ? folder.id : null;
  if (seenKey !== key) { setSeenKey(key); setRows(null); setDirty(false); }
  useEffect(() => {
    if (!open || !folder) return;
    let live = true;
    void (async () => {
      const [a, p] = await Promise.all([
        apiFetch<AccessRow[] | { data?: AccessRow[] }>(`/api/sop-folders/${folder.id}/access`, { cache: "no-store" }),
        apiFetch<{ data?: PersonRef[] } | PersonRef[]>("/api/users?scope=all&limit=500", { cache: "no-store" }),
      ]);
      if (!live) return;
      setRows(a.ok ? (Array.isArray(a.data) ? a.data : a.data?.data ?? []) : []);
      setPeople(p.ok ? (Array.isArray(p.data) ? p.data : p.data?.data ?? []) : []);
    })();
    return () => { live = false; };
  }, [open, folder]);

  const granted = useMemo(() => new Set((rows ?? []).map((r) => r.user.id)), [rows]);
  const options: PickerOption[] = people.filter((p) => !granted.has(p.id)).map((p) => ({ value: p.id, label: personName(p), description: p.email ?? undefined, glyph: <PersonAvatar person={p} size={20} /> }));

  const add = (id: string) => {
    const p = people.find((x) => x.id === id);
    if (!p) return;
    setRows((r) => [...(r ?? []), { user: p, role: "EDITOR" }]);
    setDirty(true);
    setAddOpen(false);
  };
  const setRole = (id: string, role: FolderRole) => { setRows((r) => (r ?? []).map((x) => (x.user.id === id ? { ...x, role } : x))); setDirty(true); setRoleFor(null); };
  const remove = (id: string) => { setRows((r) => (r ?? []).filter((x) => x.user.id !== id)); setDirty(true); };
  const save = async () => {
    if (!folder || saving) return;
    setSaving(true);
    const r = await apiFetch(`/api/sop-folders/${folder.id}/access`, { method: "PATCH", json: { grants: (rows ?? []).map((x) => ({ userId: x.user.id, role: x.role })) } });
    setSaving(false);
    if (!r.ok) { toast(r.error || "Couldn't save the sharing", { tone: "danger" }); return; }
    toast("Sharing updated");
    setDirty(false);
    onSaved?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>Share {folder?.name ?? "folder"}</DialogTitle>
        <DialogDescription>Who can see the SOPs in this folder and its subfolders. Admins always can. Full access also manages the folder.</DialogDescription>
        <div className="mt-2 flex flex-col">
          <div className="flex h-11 items-center gap-3 border-b border-line text-base text-ink">
            <span className="min-w-0 flex-1">Admins at {boot.org.name}</span>
            <span className="shrink-0 text-xs font-medium text-ink-2">{OBJECT_ROLE_LABEL.FULL}</span>
          </div>
          {rows === null ? (
            <div className="py-2"><SkeletonRows rows={3} rowHeight="36px" /></div>
          ) : rows.length === 0 ? (
            <p className="py-3 text-sm text-ink-2">Nobody else yet. Add people below so they can find this folder.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {rows.map((r) => (
                <li key={r.user.id} className="flex h-9 items-center gap-2 text-base text-ink">
                  <PersonAvatar person={r.user} size={24} />
                  <span className="min-w-0 flex-1 truncate">{personName(r.user)}</span>
                  <span className="relative">
                    <button type="button" onClick={() => setRoleFor(roleFor === r.user.id ? null : r.user.id)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">{ROLE_LABEL[r.role]} <ChevronDown className="h-3.5 w-3.5" aria-hidden /></button>
                    <Picker open={roleFor === r.user.id} onClose={() => setRoleFor(null)} ariaLabel="Role" selected={r.role} onSelect={(v) => setRole(r.user.id, v as FolderRole)} sections={[{ options: ROLES.map((x) => ({ value: x, label: ROLE_LABEL[x] })) }]} width={200} align="end" />
                  </span>
                  <button type="button" onClick={() => remove(r.user.id)} aria-label={`Remove ${personName(r.user)}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><X className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
                </li>
              ))}
            </ul>
          )}
          <span className="relative mt-2 block">
            <button type="button" onClick={() => setAddOpen((o) => !o)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-brand-deep hover:bg-hover"><UserPlus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add people</button>
            <Picker open={addOpen} onClose={() => setAddOpen(false)} ariaLabel="Add people" searchPlaceholder="Find a person" onSelect={add} sections={[{ options }]} width={320} />
          </span>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={!dirty || saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">{saving ? <Dots variant="pending" /> : null} Save</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
