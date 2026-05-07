"use client";

// Reusable polymorphic tag picker. Drop on any entity-detail page,
// pass `entityType` + `entityId`, and it handles fetch + assign +
// unassign through /api/tag-assignments. Future Phase-2 modules
// (Expenses, Compensation, ATS Candidates) just import and pass
// their entity tuple — no per-module schema work.

import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import { Plus, X, Tag as TagIcon, Check } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Assignment = {
  id: string;
  tag: { id: string; name: string; type: string; color: string | null; archived: boolean };
};

type TagOption = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  archived: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  COST_CENTER: "Cost center",
  BUSINESS_UNIT: "Business unit",
  LOCATION: "Location",
  REGION: "Region",
  PROJECT: "Project",
  FUNCTION: "Function",
  CUSTOM: "Custom",
};

export function TagPicker({
  entityType,
  entityId,
  canEdit = true,
  className,
}: {
  entityType: string;
  entityId: string;
  canEdit?: boolean;
  className?: string;
}) {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [allTags, setAllTags] = useState<TagOption[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();

  const assignedIds = useMemo(
    () => new Set((assignments ?? []).map((a) => a.tag.id)),
    [assignments],
  );

  // Initial fetch — assignments for this entity. Tag options lazy-load
  // when the picker opens so we don't pay for the full org tag list
  // on every detail page mount.
  useEffect(() => {
    if (!entityId) return;
    fetch(`/api/tag-assignments?entityType=${entityType}&entityId=${entityId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setAssignments(Array.isArray(d) ? d : []))
      .catch(() => setAssignments([]));
  }, [entityType, entityId]);

  useEffect(() => {
    if (!open || allTags !== null) return;
    fetch("/api/tags")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setAllTags(Array.isArray(d) ? d : []))
      .catch(() => setAllTags([]));
  }, [open, allTags]);

  // Click-outside to dismiss the popover.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function assign(tagId: string) {
    setBusy(tagId);
    try {
      const res = await fetch("/api/tag-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId, entityType, entityId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't add tag", description: data?.error ?? "Unknown error" });
        return;
      }
      // Refresh assignments — cheap and authoritative.
      const after = await fetch(`/api/tag-assignments?entityType=${entityType}&entityId=${entityId}`)
        .then((r) => r.json());
      setAssignments(Array.isArray(after) ? after : []);
    } finally {
      setBusy(null);
    }
  }

  async function unassign(assignmentId: string) {
    setBusy(assignmentId);
    try {
      const res = await fetch(`/api/tag-assignments?id=${assignmentId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({ type: "error", title: "Couldn't remove tag", description: data?.error ?? "Unknown error" });
        return;
      }
      setAssignments((prev) => (prev ?? []).filter((a) => a.id !== assignmentId));
    } finally {
      setBusy(null);
    }
  }

  // Group available (non-archived, non-assigned) tags by type for the
  // Command palette. Already-assigned tags are still shown at the top
  // with a check, so the picker doubles as "what's already on this".
  const grouped = useMemo(() => {
    if (!allTags) return new Map<string, TagOption[]>();
    const m = new Map<string, TagOption[]>();
    const filtered = allTags.filter((t) => !t.archived);
    for (const t of filtered) {
      const arr = m.get(t.type) ?? [];
      arr.push(t);
      m.set(t.type, arr);
    }
    return m;
  }, [allTags]);

  const isLoading = assignments === null;

  return (
    <div className={className}>
      <div className="flex items-center gap-2 flex-wrap">
        {isLoading && <span className="text-xs text-muted">Loading tags…</span>}
        {!isLoading && (assignments ?? []).length === 0 && !canEdit && (
          <span className="text-xs text-muted">No tags</span>
        )}
        {(assignments ?? []).map((a) => (
          <Badge
            key={a.id}
            variant="default"
            className="text-xs gap-1 pr-1"
          >
            <span className="text-[10px] uppercase opacity-60">{TYPE_LABELS[a.tag.type] ?? a.tag.type}</span>
            <span>{a.tag.name}</span>
            {canEdit && (
              <button
                type="button"
                onClick={() => unassign(a.id)}
                disabled={busy === a.id}
                className="ml-0.5 rounded hover:bg-white/10 p-0.5"
                aria-label={`Remove ${a.tag.name}`}
              >
                <X size={10} />
              </button>
            )}
          </Badge>
        ))}
        {canEdit && (
          <div className="relative" ref={popoverRef}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setOpen((v) => !v)}
            >
              <Plus size={12} className="mr-1" />
              Add tag
            </Button>
            {open && (
              <div className="absolute left-0 top-full mt-1 w-72 z-30 rounded-lg border border-line bg-card shadow-xl">
                <Command label="Tag picker" loop className="cmd-palette-cmd">
                  <div className="border-b border-line px-2 py-1.5">
                    <Command.Input
                      value={query}
                      onValueChange={setQuery}
                      placeholder="Search tags…"
                      className="cmd-palette-input"
                      autoFocus
                    />
                  </div>
                  <Command.List className="max-h-64 overflow-y-auto p-1">
                    {!allTags && (
                      <div className="px-3 py-2 text-xs text-muted">Loading tags…</div>
                    )}
                    {allTags && allTags.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted">
                        No tags yet. Create some in Settings → Tags.
                      </div>
                    )}
                    <Command.Empty className="px-3 py-2 text-xs text-muted">
                      No matches.
                    </Command.Empty>
                    {Array.from(grouped.entries()).map(([type, tagList]) => (
                      <Command.Group
                        key={type}
                        heading={TYPE_LABELS[type] ?? type}
                        className="cmd-palette-group"
                      >
                        {tagList.map((t) => {
                          const assigned = assignedIds.has(t.id);
                          return (
                            <Command.Item
                              key={t.id}
                              value={`${type} ${t.name}`}
                              onSelect={() => {
                                if (assigned) {
                                  const a = (assignments ?? []).find((x) => x.tag.id === t.id);
                                  if (a) unassign(a.id);
                                } else {
                                  assign(t.id);
                                }
                              }}
                              className="cmd-palette-item"
                            >
                              <TagIcon size={12} />
                              <span className="cmd-palette-label">{t.name}</span>
                              {assigned && <Check size={12} className="text-[#d4ff2e]" />}
                            </Command.Item>
                          );
                        })}
                      </Command.Group>
                    ))}
                  </Command.List>
                </Command>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
