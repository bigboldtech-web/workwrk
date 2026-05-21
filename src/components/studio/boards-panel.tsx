"use client";

// Studio → Boards tab. Lists user-built boards + an inline creation
// flow. Each board has: name, optional description, layout (Table or
// Kanban), and a custom field list (key, label, type).
//
// Why all of this matters: a Studio board is the unit of customization
// that makes a workspace a "town" — a team can spin up their own
// pipeline, their own ticket queue, their own anything without an
// admin schema change. Backing data is StudioBoard + StudioItem; the
// canonical <BoardView> renderer drives display on /studio/boards/[slug].
//
// `scope` (optional) constrains the list + creation defaults to a
// specific (workspace, product) — used when this panel is embedded
// inside an app's workspace nav rather than the global /studio page.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus, Loader2, X, Layers, Table as TableIcon, Kanban, ChevronRight,
  Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TemplateBrowserDialog } from "@/components/studio/template-browser";

type BoardRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  layout: "TABLE" | "KANBAN";
  productSlug: string | null;
  workspaceId: string | null;
  color: string | null;
  updatedAt: string;
  _count: { items: number };
};

type FieldDraft = {
  key: string;
  label: string;
  type: "TEXT" | "TEXTAREA" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT" | "MULTI_SELECT" | "URL" | "EMAIL";
  optionsCsv?: string; // for SELECT / MULTI_SELECT, comma-separated values
};

const FIELD_TYPE_LABEL: Record<FieldDraft["type"], string> = {
  TEXT: "Text", TEXTAREA: "Long text", NUMBER: "Number", DATE: "Date",
  CHECKBOX: "Checkbox", SELECT: "Single select", MULTI_SELECT: "Multi select",
  URL: "URL", EMAIL: "Email",
};

function keyFromLabel(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "field";
  // Ensure it starts with a letter (zod regex requires this).
  return /^[a-z]/.test(base) ? base : `f_${base}`;
}

export interface StudioBoardsPanelProps {
  /** When set, the panel only shows boards in this (workspace, product)
   *  scope and auto-fills the creation form with these defaults. */
  scope?: {
    workspaceId?: string | null;
    productSlug?: string | null;
    productName?: string | null;
  };
  /** Shown above the list so the embed knows what context it's in. */
  scopeLabel?: string;
}

export function StudioBoardsPanel({ scope, scopeLabel }: StudioBoardsPanelProps = {}) {
  const [boards, setBoards] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  // New-board form
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [layout, setLayout] = useState<"TABLE" | "KANBAN">("TABLE");
  const [fields, setFields] = useState<FieldDraft[]>([
    { key: "status", label: "Status", type: "SELECT", optionsCsv: "Todo,In progress,Done" },
  ]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (scope?.workspaceId) params.set("workspace", scope.workspaceId);
      if (scope?.productSlug) params.set("product", scope.productSlug);
      const qs = params.toString();
      const r = await fetch(`/api/studio/boards${qs ? `?${qs}` : ""}`);
      if (!r.ok) return;
      const d = await r.json();
      setBoards(d.boards ?? []);
    } finally {
      setLoading(false);
    }
  }, [scope?.workspaceId, scope?.productSlug]);

  useEffect(() => { refresh(); }, [refresh]);

  const resetForm = () => {
    setName(""); setDescription(""); setLayout("TABLE");
    setFields([{ key: "status", label: "Status", type: "SELECT", optionsCsv: "Todo,In progress,Done" }]);
    setError(null);
  };

  const handleAddField = () => {
    setFields((prev) => [...prev, { key: "", label: "", type: "TEXT" }]);
  };
  const handleRemoveField = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  };
  const handleFieldChange = (idx: number, patch: Partial<FieldDraft>) => {
    setFields((prev) => prev.map((f, i) => i === idx ? { ...f, ...patch } : f));
  };

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError("Name is required"); return; }
    // Auto-fill blank field keys from labels just before submit so the
    // user doesn't have to think about identifiers.
    const fieldsClean = fields
      .filter((f) => (f.label ?? "").trim().length > 0)
      .map((f) => ({
        key: (f.key && f.key.trim()) || keyFromLabel(f.label),
        label: f.label.trim(),
        type: f.type,
        ...(f.type === "SELECT" || f.type === "MULTI_SELECT"
          ? {
              options: {
                choices: (f.optionsCsv ?? "")
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((v) => ({ value: v.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label: v })),
              },
            }
          : {}),
      }));

    setCreating(true);
    try {
      const r = await fetch("/api/studio/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          layout,
          fields: fieldsClean,
          workspaceId: scope?.workspaceId ?? undefined,
          productSlug: scope?.productSlug ?? undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || "Failed to create board");
        return;
      }
      setShowNew(false);
      resetForm();
      await refresh();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold inline-flex items-center gap-2">
            <Layers size={14} /> Custom boards
            {scopeLabel && (
              <span className="text-xs font-normal text-muted-2">· {scopeLabel}</span>
            )}
          </h2>
          <p className="text-xs text-muted-2 mt-0.5 max-w-xl">
            Build your own tables and kanbans without waiting for a schema change. Each board carries its own columns and lives inside a workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowTemplates(true)}
            className="gap-1"
            title="Install from marketplace"
          >
            <Store size={14} /> Browse templates
          </Button>
          <Button size="sm" onClick={() => setShowNew(true)} className="gap-1">
            <Plus size={14} /> New board
          </Button>
        </div>
      </div>

      {showTemplates && (
        <TemplateBrowserDialog
          scope={scope}
          onClose={() => setShowTemplates(false)}
          onInstalled={async () => { setShowTemplates(false); await refresh(); }}
        />
      )}

      {loading ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-sm text-muted-2 inline-flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : boards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
          <Layers size={32} className="mx-auto mb-2 text-muted-2" />
          <p className="text-sm font-medium mb-1">No custom boards yet</p>
          <p className="text-xs text-muted-2 mb-4 max-w-md mx-auto">
            Studio boards let your team build their own town inside any app — a custom pipeline, a department-specific tracker, a project board only your team uses.
          </p>
          <Button size="sm" onClick={() => setShowNew(true)} className="gap-1">
            <Plus size={14} /> Create first board
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {boards.map((b) => (
            <Link
              key={b.id}
              href={`/studio/boards/${b.slug}`}
              className="group rounded-xl border border-border bg-surface hover:border-violet-300 dark:hover:border-violet-700 transition-colors p-4 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                {b.layout === "KANBAN" ? (
                  <Kanban size={14} className="text-violet-600" />
                ) : (
                  <TableIcon size={14} className="text-violet-600" />
                )}
                <h3 className="font-medium text-sm truncate flex-1">{b.name}</h3>
                <ChevronRight size={14} className="text-muted-2 group-hover:translate-x-0.5 transition-transform" />
              </div>
              {b.description && (
                <p className="text-xs text-muted-2 line-clamp-2">{b.description}</p>
              )}
              <div className="flex items-center gap-3 text-[11px] text-muted-2 mt-auto pt-1">
                <span>{b._count.items} {b._count.items === 1 ? "item" : "items"}</span>
                <span>·</span>
                <span className="capitalize">{b.layout.toLowerCase()}</span>
                {b.productSlug && (
                  <>
                    <span>·</span>
                    <span className="text-[10px] uppercase tracking-wider">{b.productSlug.replace(/^workwrk-/, "")}</span>
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => { if (!creating) { setShowNew(false); resetForm(); } }}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-3 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">New custom board</h2>
              <button
                type="button"
                onClick={() => { setShowNew(false); resetForm(); }}
                className="p-1 rounded hover:bg-surface-2 text-muted"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-2">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Customer feedback tracker"
                  autoFocus
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-2">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional — what is this board for?"
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-2">Layout</label>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setLayout("TABLE")}
                    className={
                      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs " +
                      (layout === "TABLE" ? "border-violet-500 bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300" : "border-border text-muted")
                    }
                  >
                    <TableIcon size={12} /> Table
                  </button>
                  <button
                    type="button"
                    onClick={() => setLayout("KANBAN")}
                    className={
                      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs " +
                      (layout === "KANBAN" ? "border-violet-500 bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300" : "border-border text-muted")
                    }
                  >
                    <Kanban size={12} /> Kanban
                  </button>
                </div>
                {layout === "KANBAN" && (
                  <p className="text-[11px] text-muted-2 mt-1">
                    Kanban groups rows by your <code className="px-1 rounded bg-surface-2">status</code> field — make sure to include one (Select type).
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-muted-2">Columns</label>
                  <button
                    type="button"
                    onClick={handleAddField}
                    className="text-xs text-violet-600 hover:text-violet-700 inline-flex items-center gap-1"
                  >
                    <Plus size={11} /> Add column
                  </button>
                </div>
                <div className="space-y-2">
                  {fields.map((f, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <input
                        type="text"
                        value={f.label}
                        onChange={(e) => handleFieldChange(idx, { label: e.target.value })}
                        placeholder="Column name"
                        className="flex-1 px-2.5 py-1.5 rounded-md border border-border bg-surface text-xs"
                      />
                      <select
                        value={f.type}
                        onChange={(e) => handleFieldChange(idx, { type: e.target.value as FieldDraft["type"] })}
                        className="px-2.5 py-1.5 rounded-md border border-border bg-surface text-xs"
                      >
                        {(Object.keys(FIELD_TYPE_LABEL) as FieldDraft["type"][]).map((t) => (
                          <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleRemoveField(idx)}
                        className="p-1.5 rounded text-muted-2 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                        aria-label="Remove column"
                        disabled={fields.length === 1}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {fields.some((f) => f.type === "SELECT" || f.type === "MULTI_SELECT") && (
                    <div className="space-y-1 pl-1 pt-1 border-t border-border">
                      <p className="text-[10px] uppercase tracking-wider text-muted-2 mt-2">Select choices (comma-separated)</p>
                      {fields.map((f, idx) =>
                        f.type === "SELECT" || f.type === "MULTI_SELECT" ? (
                          <div key={`opts-${idx}`} className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-2 w-24 truncate">{f.label || `Column ${idx + 1}`}</span>
                            <input
                              type="text"
                              value={f.optionsCsv ?? ""}
                              onChange={(e) => handleFieldChange(idx, { optionsCsv: e.target.value })}
                              placeholder="Todo, In progress, Done"
                              className="flex-1 px-2.5 py-1 rounded-md border border-border bg-surface text-xs"
                            />
                          </div>
                        ) : null,
                      )}
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <p className="text-xs text-rose-600">{error}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowNew(false); resetForm(); }}
                  disabled={creating}
                  className="px-3 py-1.5 rounded-md text-sm text-muted hover:bg-surface-2"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={creating || !name.trim()}
                  className="px-4 py-1.5 rounded-md text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Create board
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
