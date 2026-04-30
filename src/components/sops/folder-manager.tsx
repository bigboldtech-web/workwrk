"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Trash2, Loader2, Users as UsersIcon, FolderOpen, ChevronLeft, Check, Pencil, X } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog-provider";

interface Folder {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  _count?: { sops: number; access: number };
}

interface AccessUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar?: string | null;
  role?: { title: string } | null;
  department?: { name: string } | null;
}

/**
 * Admin-only: CRUD folders + manage per-folder user access.
 *
 * Two-panel flow:
 *   1. Folder list — create/rename/delete folders, see SOP + member counts.
 *   2. Drilled-in access list for a selected folder — set the user
 *      access list atomically via PATCH.
 */
export function FolderManager({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const confirm = useConfirm();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingName, setCreatingName] = useState("");

  // Drill-in state
  const [selected, setSelected] = useState<Folder | null>(null);
  const [orgUsers, setOrgUsers] = useState<AccessUser[] | null>(null);
  const [accessUserIds, setAccessUserIds] = useState<Set<string>>(new Set());
  const [accessDirty, setAccessDirty] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);

  // Inline rename state
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  async function loadFolders() {
    setLoading(true);
    try {
      const res = await fetch("/api/sop-folders");
      if (res.ok) {
        const d = await res.json();
        setFolders(Array.isArray(d) ? d : d.data || []);
      }
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => {
    if (!open) return;
    loadFolders();
  }, [open]);

  async function createFolder() {
    const name = creatingName.trim();
    if (!name) return;
    const res = await fetch("/api/sop-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      toastSuccess("Folder created");
      setCreatingName("");
      loadFolders();
    } else {
      const body = await res.json().catch(() => ({}));
      toastError(body?.error || "Failed to create folder");
    }
  }

  async function deleteFolder(f: Folder) {
    if ((f._count?.sops ?? 0) > 0) {
      toastError(`Move the ${f._count?.sops} SOP${f._count?.sops === 1 ? "" : "s"} out of "${f.name}" before deleting.`);
      return;
    }
    if (!(await confirm({
      title: `Delete folder "${f.name}"?`,
      description: "Empty folders only. The folder will be removed and any access grants on it cleared.",
      confirmLabel: "Delete folder",
      destructive: true,
    }))) return;
    const res = await fetch(`/api/sop-folders/${f.id}`, { method: "DELETE" });
    if (res.ok) {
      toastSuccess("Folder deleted");
      loadFolders();
    } else {
      const body = await res.json().catch(() => ({}));
      toastError(body?.error || "Failed to delete folder");
    }
  }

  function beginRename(f: Folder) {
    setRenameId(f.id);
    setRenameValue(f.name);
  }

  function cancelRename() {
    setRenameId(null);
    setRenameValue("");
  }

  async function saveRename() {
    const name = renameValue.trim();
    if (!name || !renameId) return;
    setRenaming(true);
    try {
      const res = await fetch(`/api/sop-folders/${renameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        toastSuccess("Folder renamed");
        cancelRename();
        loadFolders();
      } else {
        const body = await res.json().catch(() => ({}));
        toastError(body?.error || "Failed to rename folder");
      }
    } finally { setRenaming(false); }
  }

  async function openAccess(f: Folder) {
    setSelected(f);
    setAccessDirty(false);
    // Load current access list + everyone in the org so the admin can toggle.
    const [accessRes, peopleRes] = await Promise.all([
      fetch(`/api/sop-folders/${f.id}/access`),
      fetch("/api/my-team"),
    ]);
    const access = accessRes.ok ? await accessRes.json().then((d) => d.data ?? d) : [];
    const people = peopleRes.ok ? await peopleRes.json().then((d) => d.data ?? d) : null;
    const grantedIds = new Set<string>(
      (Array.isArray(access) ? access : []).map((row: any) => row.user?.id).filter(Boolean),
    );
    setAccessUserIds(grantedIds);
    // `/api/my-team` returns recursive reports for managers; admins are
    // managers too, but we want the full list. Fall back to pulling via
    // /api/users if my-team returns too few rows.
    if (people && Array.isArray(people.members) && people.members.length > 1) {
      setOrgUsers(people.members);
    } else {
      const allRes = await fetch("/api/users");
      if (allRes.ok) {
        const d = await allRes.json();
        const list = Array.isArray(d) ? d : d.data || [];
        setOrgUsers(list);
      } else {
        setOrgUsers([]);
      }
    }
  }

  function toggleUser(userId: string) {
    setAccessUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
    setAccessDirty(true);
  }

  async function saveAccess() {
    if (!selected) return;
    setSavingAccess(true);
    try {
      const res = await fetch(`/api/sop-folders/${selected.id}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: Array.from(accessUserIds) }),
      });
      if (res.ok) {
        toastSuccess("Access updated");
        setAccessDirty(false);
        loadFolders();
      } else {
        toastError("Failed to save access");
      }
    } finally { setSavingAccess(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setSelected(null); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selected ? (
              <>
                <button className="text-muted hover:text-foreground" onClick={() => setSelected(null)} aria-label="Back">
                  <ChevronLeft size={18} />
                </button>
                <span>{selected.name} · Access</span>
              </>
            ) : (
              <>SOP folders</>
            )}
          </DialogTitle>
        </DialogHeader>

        {!selected && (
          <div className="space-y-4">
            <p className="text-xs text-muted">
              Organize SOPs into folders and control who sees what. Managers assigned to a folder can read,
              create, and edit SOPs in it; everyone else can&apos;t. Org admins see every folder regardless.
            </p>

            {/* Create new */}
            <div className="flex items-center gap-2">
              <Input
                value={creatingName}
                onChange={(e) => setCreatingName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createFolder(); } }}
                placeholder="New folder name (e.g. Marketing, HR, Operations)"
                className="flex-1"
              />
              <Button onClick={createFolder} disabled={!creatingName.trim()} className="gap-1.5">
                <Plus size={14} /> Create
              </Button>
            </div>

            {/* List */}
            {loading || folders === null ? (
              <div className="flex items-center gap-2 text-xs text-muted py-4"><Loader2 size={14} className="animate-spin" /> Loading folders…</div>
            ) : folders.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted">
                No folders yet. Create one above to start scoping SOPs.
              </div>
            ) : (
              <div className="space-y-1.5">
                {folders.map((f) => {
                  const isRenaming = renameId === f.id;
                  const hasSops = (f._count?.sops ?? 0) > 0;
                  return (
                    <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-muted-2 transition-colors">
                      <FolderOpen size={16} className="text-[#d4ff2e] shrink-0" />
                      <div className="flex-1 min-w-0">
                        {isRenaming ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); saveRename(); }
                                if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                              }}
                              autoFocus
                              className="h-7 text-sm"
                              disabled={renaming}
                            />
                            <Button size="sm" variant="outline" className="h-7 px-2" onClick={saveRename} disabled={renaming || !renameValue.trim()} aria-label="Save rename">
                              {renaming ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={cancelRename} disabled={renaming} aria-label="Cancel rename">
                              <X size={12} />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="text-sm font-medium truncate">{f.name}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant="outline" className="text-[10px] h-4">{f._count?.sops ?? 0} SOP{f._count?.sops === 1 ? "" : "s"}</Badge>
                              <Badge variant="outline" className="text-[10px] h-4">{f._count?.access ?? 0} user{f._count?.access === 1 ? "" : "s"}</Badge>
                            </div>
                          </>
                        )}
                      </div>
                      {!isRenaming && (
                        <>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => beginRename(f)} aria-label="Rename folder">
                            <Pencil size={13} className="text-muted" />
                          </Button>
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openAccess(f)}>
                            <UsersIcon size={12} /> Access
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`h-8 w-8 ${hasSops ? "text-muted-2 cursor-not-allowed" : "text-red-400 hover:text-red-300"}`}
                            onClick={() => deleteFolder(f)}
                            disabled={hasSops}
                            title={hasSops ? `Cannot delete — move the ${f._count?.sops} SOP${f._count?.sops === 1 ? "" : "s"} out first` : "Delete folder"}
                            aria-label="Delete folder"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {selected && (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Pick the users who can see and manage SOPs in <strong>{selected.name}</strong>.
              Org admins always have access regardless of this list.
            </p>

            {orgUsers === null ? (
              <div className="flex items-center gap-2 text-xs text-muted py-4"><Loader2 size={14} className="animate-spin" /> Loading people…</div>
            ) : orgUsers.length === 0 ? (
              <div className="text-xs text-muted">No people found in your org.</div>
            ) : (
              <div className="max-h-96 overflow-y-auto space-y-1 border border-border rounded-lg p-1">
                {orgUsers.map((u) => {
                  const checked = accessUserIds.has(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleUser(u.id)}
                      className={`w-full flex items-center gap-3 p-2 rounded-md text-left transition-colors ${checked ? "bg-[rgba(212,255,46,0.08)]" : "hover:bg-surface-2"}`}
                    >
                      <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${checked ? "border-[#d4ff2e] bg-[#a8cc24]" : "border-border"}`}>
                        {checked && <Check size={10} className="text-[#0a0a0a]" />}
                      </div>
                      <Avatar className="h-6 w-6">
                        {u.avatar ? <AvatarImage src={u.avatar} alt="" /> : null}
                        <AvatarFallback className="text-[9px]">{u.firstName[0]}{u.lastName[0]}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">{u.firstName} {u.lastName}</div>
                        {u.role?.title && <div className="text-[10px] text-muted">{u.role.title}{u.department?.name ? ` · ${u.department.name}` : ""}</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {selected ? (
            <>
              <Button variant="outline" onClick={() => setSelected(null)}>Back</Button>
              <Button onClick={saveAccess} disabled={!accessDirty || savingAccess}>
                {savingAccess ? <><Loader2 size={12} className="animate-spin mr-1" /> Saving…</> : "Save access"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
