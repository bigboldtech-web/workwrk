"use client";

// Tag management UI. Renders all tags grouped by type with create /
// rename / archive / delete affordances. State is held client-side
// after the initial server render; mutations call the JSON API and
// optimistically update local state.
//
// At Fortune-500 scale a single org may carry 1000+ tags (a US
// healthcare conglomerate could easily have 200+ cost centers and
// 100+ regions). We render grouped sections rather than a flat list
// so admins can scan one dimension at a time. The server cap is 1000
// rows per fetch — past that we'd add type-scoped pagination.

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import {
  Plus,
  MoreHorizontal,
  Archive,
  ArchiveRestore,
  Trash2,
  Pencil,
  Tag as TagIcon,
} from "lucide-react";

export type TagRow = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  description: string | null;
  archived: boolean;
  assignmentCount: number;
};

const TYPE_ORDER = [
  "COST_CENTER",
  "BUSINESS_UNIT",
  "LOCATION",
  "REGION",
  "PROJECT",
  "FUNCTION",
  "CUSTOM",
] as const;

const TYPE_LABELS: Record<string, string> = {
  COST_CENTER: "Cost centers",
  BUSINESS_UNIT: "Business units",
  LOCATION: "Locations",
  REGION: "Regions",
  PROJECT: "Projects",
  FUNCTION: "Functions",
  CUSTOM: "Custom",
};

const TYPE_DESCRIPTIONS: Record<string, string> = {
  COST_CENTER: "Budget owners. Travels with every transaction for finance reporting.",
  BUSINESS_UNIT: "Top-level operating units inside the org.",
  LOCATION: "Specific offices, sites, or facilities.",
  REGION: "Geographic groupings (NAM, EMEA, APAC, etc).",
  PROJECT: "Time-boxed initiatives across teams.",
  FUNCTION: "Cross-cutting functional groupings (Engineering, GTM, etc).",
  CUSTOM: "Any dimension that doesn't fit the above.",
};

export function TagsManager({ initial }: { initial: TagRow[] }) {
  const [tags, setTags] = useState<TagRow[]>(initial);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<TagRow | null>(null);
  const [creatingType, setCreatingType] = useState<string | null>(null);
  const { toast } = useToast();

  const visible = tags.filter((t) => showArchived || !t.archived);

  // Group by type, preserving the canonical order even for empty groups
  // so admins always see every dimension as a "create here" target.
  const byType = new Map<string, TagRow[]>();
  for (const t of TYPE_ORDER) byType.set(t, []);
  for (const tag of visible) {
    const arr = byType.get(tag.type) ?? [];
    arr.push(tag);
    byType.set(tag.type, arr);
  }

  async function createTag(type: string, name: string, description: string) {
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, name, description }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: "Couldn't create tag", description: data?.error ?? "Unknown error" });
      return;
    }
    // Reactivation may return existing id — replace instead of append.
    setTags((prev) => {
      const without = prev.filter((t) => t.id !== data.id);
      return [
        ...without,
        {
          id: data.id,
          name: data.name,
          type: data.type,
          color: data.color ?? null,
          description: data.description ?? null,
          archived: !!data.archived,
          assignmentCount: 0,
        },
      ];
    });
    toast({ type: "success", title: "Tag created" });
    setCreatingType(null);
  }

  async function updateTag(id: string, patch: Partial<Pick<TagRow, "name" | "description" | "archived" | "color">>) {
    const res = await fetch(`/api/tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: "Couldn't update tag", description: data?.error ?? "Unknown error" });
      return;
    }
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setEditing(null);
  }

  async function deleteTag(id: string, count: number) {
    if (count > 0) {
      const ok = confirm(
        `This tag is applied to ${count} record${count === 1 ? "" : "s"}. Deleting will remove it everywhere. Archive instead?\n\nClick OK to delete anyway, Cancel to back out.`,
      );
      if (!ok) return;
    }
    const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ type: "error", title: "Couldn't delete tag", description: data?.error ?? "Unknown error" });
      return;
    }
    setTags((prev) => prev.filter((t) => t.id !== id));
    toast({ type: "success", title: "Tag deleted" });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TagIcon size={20} /> Dimensional tags
          </h1>
          <p className="text-muted text-sm mt-1 max-w-prose">
            Cost centers, business units, regions, projects, and any custom
            dimensions you want to slice reports by. Tags travel across People,
            Tasks, KRAs, OKRs, and (soon) Expenses and Compensation.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </Button>
      </div>

      {TYPE_ORDER.map((type) => {
        const rows = byType.get(type) ?? [];
        return (
          <Card key={type}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{TYPE_LABELS[type]}</CardTitle>
                  <p className="text-xs text-muted mt-1">{TYPE_DESCRIPTIONS[type]}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCreatingType(type)}
                  className="flex-shrink-0"
                >
                  <Plus size={12} className="mr-1" /> Add
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-xs text-muted">No {TYPE_LABELS[type].toLowerCase()} yet.</p>
              ) : (
                <ul className="divide-y divide-white/5">
                  {rows.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between py-2"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Badge variant={t.archived ? "secondary" : "default"} className="text-xs">
                          {t.name}
                        </Badge>
                        {t.description && (
                          <span className="text-xs text-muted truncate">{t.description}</span>
                        )}
                        <span className="text-xs text-muted ml-auto flex-shrink-0">
                          {t.assignmentCount} record{t.assignmentCount === 1 ? "" : "s"}
                        </span>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="ml-2 h-7 w-7 p-0">
                            <MoreHorizontal size={14} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(t)}>
                            <Pencil size={12} className="mr-2" /> Edit
                          </DropdownMenuItem>
                          {t.archived ? (
                            <DropdownMenuItem onSelect={() => updateTag(t.id, { archived: false })}>
                              <ArchiveRestore size={12} className="mr-2" /> Unarchive
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => updateTag(t.id, { archived: true })}>
                              <Archive size={12} className="mr-2" /> Archive
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => deleteTag(t.id, t.assignmentCount)}
                            className="text-red-400"
                          >
                            <Trash2 size={12} className="mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}

      {creatingType && (
        <CreateTagDialog
          type={creatingType}
          onClose={() => setCreatingType(null)}
          onCreate={(name, description) => createTag(creatingType, name, description)}
        />
      )}
      {editing && (
        <EditTagDialog
          tag={editing}
          onClose={() => setEditing(null)}
          onSave={(name, description) => updateTag(editing.id, { name, description })}
        />
      )}
    </div>
  );
}

function CreateTagDialog({
  type,
  onClose,
  onCreate,
}: {
  type: string;
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {TYPE_LABELS[type]?.toLowerCase().replace(/s$/, "")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === "COST_CENTER" ? "e.g. CC-1234 Engineering" : "e.g. EMEA"}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Description (optional)</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Help future admins understand when to use this."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name.trim() || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onCreate(name.trim(), description.trim());
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTagDialog({
  tag,
  onClose,
  onSave,
}: {
  tag: TagRow;
  onClose: () => void;
  onSave: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState(tag.name);
  const [description, setDescription] = useState(tag.description ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit tag</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name.trim() || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(name.trim(), description.trim());
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
