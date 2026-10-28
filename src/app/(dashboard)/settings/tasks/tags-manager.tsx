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
// rows per fetch: past that we'd add type-scoped pagination.
//
// THE SHARED PARTS (settings-cleanup Phase 6, B3 to B10): the search and
// Show archived are the tab's toolbar (SettingsToolbar, in the header's own
// row, the way Members draws its search), so nothing floats beside the
// cards. Each dimension is one SettingsCard: its title and one-line
// description, a ghost Add at the right, and every tag a SettingsRow whose
// label is the tag as a neutral label chip (TAG, design-system 5.9: label
// chips are never brand blue). A group that shows no tag says so in one
// inline line with its action (task-system-ui.ts tagGroupEmptyLine). The
// seven cards sit under one "Tag groups" section label, whose line says
// where tags travel. Create, edit, archive and delete are unchanged.

import { useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsToolbar } from "@/components/settings/settings-page";
import { btn } from "@/components/settings/settings-form";
import { TAG } from "@/components/account/account-ui";
import { TOOLBAR_CHIP } from "@/components/layout/os/page-header/page-header";
import { tagGroupEmptyLine, tagNoun } from "./task-system-ui";
import {
  Plus,
  MoreHorizontal,
  Archive,
  ArchiveRestore,
  Trash2,
  Pencil,
  Search,
  X,
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

// Plain words, not finance or org-design jargon (final Settings review, L5).
const TYPE_DESCRIPTIONS: Record<string, string> = {
  COST_CENTER: "Who pays for the work, for finance reports.",
  BUSINESS_UNIT: "The main parts of the company.",
  LOCATION: "Offices, sites and other places people work.",
  REGION: "Groups of countries, such as North America or Europe.",
  PROJECT: "Work with a start and an end that crosses teams.",
  FUNCTION: "Kinds of work across teams, such as engineering or sales.",
  CUSTOM: "Anything the groups above do not cover.",
};

// What a failure says when the server gave no reason (final Settings review, L4).
const NO_ANSWER = "Check your connection, then try again.";

export function TagsManager({ initial }: { initial: TagRow[] }) {
  const [tags, setTags] = useState<TagRow[]>(initial);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<TagRow | null>(null);
  const [creatingType, setCreatingType] = useState<string | null>(null);
  // The shell's toast, whose region is polite and always mounted (final
  // Settings review, M6), not the older ui/toast.
  const { toast } = useOsToast();
  const confirm = useConfirm();

  // The search the old /settings/tags page had (name and category), kept:
  // it matches the tag name, its description and its dimension label.
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const visible = tags.filter(
    (t) =>
      (showArchived || !t.archived) &&
      (!q ||
        t.name.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        (TYPE_LABELS[t.type] ?? t.type).toLowerCase().includes(q)),
  );

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
      toast("Couldn't create tag", { tone: "danger", description: data?.error ?? NO_ANSWER });
      return;
    }
    // Reactivation may return existing id: replace instead of append.
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
    toast("Tag created", { tone: "success" });
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
      toast("Couldn't update tag", { tone: "danger", description: data?.error ?? NO_ANSWER });
      return;
    }
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setEditing(null);
  }

  async function deleteTag(id: string, count: number) {
    if (count > 0) {
      const ok = await confirm({
        title: "Delete tag",
        description: `This tag is applied to ${count} record${count === 1 ? "" : "s"}. Deleting will remove it everywhere. Archive instead?`,
        destructive: true,
        confirmLabel: "Delete anyway",
      });
      if (!ok) return;
    }
    const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast("Couldn't delete tag", { tone: "danger", description: data?.error ?? NO_ANSWER });
      return;
    }
    setTags((prev) => prev.filter((t) => t.id !== id));
    toast("Tag deleted", { tone: "success" });
  }

  // Archived tags per group, for the line a group shows when they are all it
  // holds and they are hidden: "2 archived regions · Show archived".
  const archivedIn = (type: string) => (showArchived ? 0 : tags.filter((t) => t.type === type && t.archived).length);

  return (
    <>
      <SettingsToolbar
        left={
          <>
            <label className="flex h-9 w-[280px] max-w-full items-center gap-2 rounded-md border border-line-strong bg-raised px-3 focus-within:shadow-[0_0_0_3px_var(--os-focus-halo)]">
              <Search className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tags" aria-label="Search tags" className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none" />
              {search ? <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="text-ink-3 hover:text-ink"><X className="h-3.5 w-3.5" aria-hidden /></button> : null}
            </label>
            {/* The words say the state (Show or Hide archived), so it is a
                plain chip that changes its label, not a pressed toggle whose
                pale fill alone would be the only cue. */}
            <button type="button" className={TOOLBAR_CHIP} onClick={() => setShowArchived((v) => !v)}>
              <Archive className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {showArchived ? "Hide archived" : "Show archived"}
            </button>
          </>
        }
      />

      <SettingsSection label="Tag groups" description="Tags travel across People, Tasks, KRAs and OKRs, so reports can be sliced by them.">
        <SettingsCardStack>
          {TYPE_ORDER.map((type) => {
            const rows = byType.get(type) ?? [];
            const noun = tagNoun(type);
            const empty = rows.length === 0 ? tagGroupEmptyLine(type, { query: q, hiddenArchived: archivedIn(type) }) : null;
            return (
              <SettingsCard
                key={type}
                title={TYPE_LABELS[type]}
                description={TYPE_DESCRIPTIONS[type]}
                // The ghost Add at the title's right, except on a group whose
                // one line is already "No cost centers yet · Add a cost
                // center": one way to add per card, never two side by side.
                actions={empty?.action?.kind === "add" ? undefined : (
                  <button type="button" aria-label={`Add a ${noun.one}`} className={btn.ghost} onClick={() => setCreatingType(type)}>
                    <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add
                  </button>
                )}
              >
                {empty ? (
                  <p className="m-0 text-base text-ink-2">
                    {empty.text}
                    {empty.action ? (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="font-medium text-brand-deep underline underline-offset-2"
                          onClick={() => {
                            if (empty.action?.kind === "clear") setSearch("");
                            else if (empty.action?.kind === "archived") setShowArchived(true);
                            else setCreatingType(type);
                          }}
                        >
                          {empty.action.label}
                        </button>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <div>
                    {rows.map((t) => (
                      <SettingsRow
                        key={t.id}
                        label={
                          // A long name ends in an ellipsis (Phase 6 review, L6). The chip is a flex box
                          // that never shrinks (TAG), so text-overflow on it clipped with no "...": the
                          // name is its own span that truncates, the chip is held to the line by
                          // max-w-full, and the wrapper around it is what gives way to "Archived".
                          <span className="inline-flex max-w-full items-center gap-2">
                            <span className="flex min-w-0">
                              <span className={`${TAG} max-w-full`} title={t.name}><span className="min-w-0 truncate">{t.name}</span></span>
                            </span>
                            {t.archived ? <span className="shrink-0 text-sm font-normal text-ink-2">Archived</span> : null}
                          </span>
                        }
                        helper={t.description ? <span className="block truncate" title={t.description}>{t.description}</span> : undefined}
                        control={
                          <>
                            <span className="text-sm tabular-nums text-ink-2">
                              {t.assignmentCount} record{t.assignmentCount === 1 ? "" : "s"}
                            </span>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button type="button" aria-label={`More actions for ${t.name}`} title="More actions" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                                  <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                                </button>
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
                                  className="text-danger-text"
                                >
                                  <Trash2 size={12} className="mr-2" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        }
                      />
                    ))}
                  </div>
                )}
              </SettingsCard>
            );
          })}
        </SettingsCardStack>
      </SettingsSection>

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
    </>
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
          {/* "New custom tag", never "New custom" (the label with its s cut off). */}
          <DialogTitle>New {tagNoun(type).one}</DialogTitle>
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
