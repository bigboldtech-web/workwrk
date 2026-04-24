"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, Plus, Edit3, Trash2, ChevronDown, ChevronRight, X, Check, AlertTriangle,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Subcategory {
  id: string;
  name: string;
  categoryId: string;
  sopCount?: number;
}

interface Category {
  id: string;
  name: string;
  subcategories: Subcategory[];
  sopCount?: number;
}

type Kind = "category" | "subcategory";

export function SopCategoryManager() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addingToCategoryId, setAddingToCategoryId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newSubName, setNewSubName] = useState("");
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [editing, setEditing] = useState<{ id: string; kind: Kind } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<null | {
    id: string;
    kind: Kind;
    name: string;
    usedCount: number;
  }>(null);
  const [busy, setBusy] = useState(false);

  const { success: toastSuccess, error: toastError } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sop-categories");
      if (!res.ok) throw new Error("Failed to load categories");
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : data?.data || []);
    } catch {
      toastError("Failed to load categories");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => { load(); }, [load]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function createCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/sop-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create");
      setNewCategoryName("");
      setShowAddCategory(false);
      toastSuccess("Category created");
      load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Failed to create");
    } finally { setBusy(false); }
  }

  async function createSubcategory(categoryId: string) {
    const name = newSubName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/sop-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, categoryId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create");
      setNewSubName("");
      setAddingToCategoryId(null);
      toastSuccess("Subcategory created");
      load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Failed to create");
    } finally { setBusy(false); }
  }

  async function renameItem() {
    if (!editing) return;
    const name = editValue.trim();
    if (!name) { setEditing(null); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/sop-categories/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type: editing.kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Rename failed");
      toastSuccess("Renamed");
      setEditing(null);
      load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Rename failed");
    } finally { setBusy(false); }
  }

  async function deleteItem(force: boolean) {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      const url = `/api/sop-categories/${confirmDelete.id}?type=${confirmDelete.kind}${force ? "&force=1" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Delete failed");
      toastSuccess(
        confirmDelete.usedCount > 0
          ? `Deleted — ${confirmDelete.usedCount} SOP${confirmDelete.usedCount === 1 ? "" : "s"} updated`
          : "Deleted",
      );
      setConfirmDelete(null);
      load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Delete failed");
    } finally { setBusy(false); }
  }

  const totalSops = categories.reduce((sum, c) => sum + (c.sopCount || 0), 0);
  const totalSubs = categories.reduce((sum, c) => sum + c.subcategories.length, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <BookOpen size={16} className="text-[#d4ff2e]" />
          SOP Categories
        </CardTitle>
        <CardDescription>
          One central place to manage the categories and subcategories SOP authors pick from.
          Renaming here updates every SOP that uses the old name.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs text-muted flex items-center gap-3">
            <span>{categories.length} categor{categories.length === 1 ? "y" : "ies"}</span>
            <span>·</span>
            <span>{totalSubs} subcategor{totalSubs === 1 ? "y" : "ies"}</span>
            <span>·</span>
            <span>{totalSops} SOP{totalSops === 1 ? "" : "s"} classified</span>
          </div>
          {!showAddCategory ? (
            <Button size="sm" onClick={() => setShowAddCategory(true)} className="gap-1.5">
              <Plus size={14} /> Add Category
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createCategory()}
                placeholder="Category name"
                className="h-8 text-sm w-48"
                autoFocus
              />
              <Button size="sm" onClick={createCategory} disabled={busy || !newCategoryName.trim()}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowAddCategory(false); setNewCategoryName(""); }}>
                <X size={14} />
              </Button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 bg-surface-2 rounded animate-pulse" />
            ))}
          </div>
        ) : categories.length === 0 ? (
          <div className="text-center py-10">
            <BookOpen size={32} className="mx-auto text-muted mb-2" />
            <p className="text-sm text-muted">No categories yet. Add your first one above.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border">
            {categories.map((cat) => {
              const isOpen = expanded.has(cat.id);
              const isEditingThis = editing?.id === cat.id && editing.kind === "category";
              return (
                <div key={cat.id}>
                  {/* Category row */}
                  <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2/40">
                    <button
                      type="button"
                      onClick={() => toggleExpand(cat.id)}
                      className="text-muted hover:text-foreground shrink-0"
                      aria-label={isOpen ? "Collapse" : "Expand"}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    {isEditingThis ? (
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameItem();
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className="h-7 text-sm flex-1"
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleExpand(cat.id)}
                        className="flex-1 text-left text-sm font-medium truncate"
                      >
                        {cat.name}
                      </button>
                    )}

                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {cat.subcategories.length} sub
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {cat.sopCount ?? 0} SOP{cat.sopCount === 1 ? "" : "s"}
                    </Badge>

                    {isEditingThis ? (
                      <>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-[#d4ff2e]" onClick={renameItem} disabled={busy} aria-label="Save">
                          <Check size={14} />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted" onClick={() => setEditing(null)} aria-label="Cancel">
                          <X size={14} />
                        </Button>
                      </>
                    ) : (
                      <div className="flex items-center gap-0.5 opacity-70 hover:opacity-100">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted hover:text-foreground"
                          onClick={() => { setAddingToCategoryId(cat.id); setNewSubName(""); if (!isOpen) toggleExpand(cat.id); }}
                          aria-label="Add subcategory"
                          title="Add subcategory"
                        >
                          <Plus size={14} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted hover:text-foreground"
                          onClick={() => { setEditing({ id: cat.id, kind: "category" }); setEditValue(cat.name); }}
                          aria-label="Rename"
                        >
                          <Edit3 size={13} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-400 hover:text-red-300"
                          onClick={() => setConfirmDelete({ id: cat.id, kind: "category", name: cat.name, usedCount: cat.sopCount || 0 })}
                          aria-label="Delete"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Subcategories */}
                  {isOpen && (
                    <div className="bg-surface-3/40 border-t border-border">
                      {cat.subcategories.length === 0 && addingToCategoryId !== cat.id && (
                        <p className="px-10 py-2 text-xs text-muted italic">No subcategories.</p>
                      )}
                      {cat.subcategories.map((sub) => {
                        const subEditing = editing?.id === sub.id && editing.kind === "subcategory";
                        return (
                          <div key={sub.id} className="flex items-center gap-2 pl-10 pr-3 py-1.5 hover:bg-surface-2/40">
                            {subEditing ? (
                              <Input
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") renameItem();
                                  if (e.key === "Escape") setEditing(null);
                                }}
                                className="h-7 text-xs flex-1"
                                autoFocus
                              />
                            ) : (
                              <span className="flex-1 text-xs truncate">{sub.name}</span>
                            )}
                            <Badge variant="secondary" className="text-[10px] shrink-0">
                              {sub.sopCount ?? 0} SOP{sub.sopCount === 1 ? "" : "s"}
                            </Badge>

                            {subEditing ? (
                              <>
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-[#d4ff2e]" onClick={renameItem} disabled={busy} aria-label="Save">
                                  <Check size={12} />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted" onClick={() => setEditing(null)} aria-label="Cancel">
                                  <X size={12} />
                                </Button>
                              </>
                            ) : (
                              <div className="flex items-center gap-0.5 opacity-70 hover:opacity-100">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-muted hover:text-foreground"
                                  onClick={() => { setEditing({ id: sub.id, kind: "subcategory" }); setEditValue(sub.name); }}
                                  aria-label="Rename"
                                >
                                  <Edit3 size={12} />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-red-400 hover:text-red-300"
                                  onClick={() => setConfirmDelete({ id: sub.id, kind: "subcategory", name: sub.name, usedCount: sub.sopCount || 0 })}
                                  aria-label="Delete"
                                >
                                  <Trash2 size={12} />
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Inline add-subcategory row */}
                      {addingToCategoryId === cat.id && (
                        <div className="flex items-center gap-2 pl-10 pr-3 py-2 bg-[rgba(212,255,46,0.04)]">
                          <Input
                            value={newSubName}
                            onChange={(e) => setNewSubName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") createSubcategory(cat.id);
                              if (e.key === "Escape") { setAddingToCategoryId(null); setNewSubName(""); }
                            }}
                            placeholder="Subcategory name"
                            className="h-7 text-xs flex-1"
                            autoFocus
                          />
                          <Button size="sm" onClick={() => createSubcategory(cat.id)} disabled={busy || !newSubName.trim()}>
                            Add
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setAddingToCategoryId(null); setNewSubName(""); }}>
                            <X size={12} />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.kind} "${confirmDelete?.name}"?`}
        description={
          confirmDelete?.usedCount
            ? `${confirmDelete.usedCount} SOP${confirmDelete.usedCount === 1 ? "" : "s"} ${confirmDelete.usedCount === 1 ? "is" : "are"} using this ${confirmDelete.kind}. Deleting will remove the ${confirmDelete.kind} from those SOPs.`
            : `Nothing currently uses this ${confirmDelete?.kind}. Safe to delete.`
        }
        confirmLabel={confirmDelete?.usedCount ? "Delete & unlink" : "Delete"}
        destructive
        loading={busy}
        onConfirm={() => deleteItem(!!confirmDelete?.usedCount)}
      />
    </Card>
  );
}
