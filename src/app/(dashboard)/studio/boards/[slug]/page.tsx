"use client";

// Studio → board view. Loads a user-built board by slug and renders
// it through the canonical <BoardView>, so the table + kanban + filter
// + bulk-edit affordances all just work. Inline "Add row" + per-cell
// edits PATCH /api/studio/boards/[slug]/items.

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft, Plus, Loader2, Table as TableIcon, Kanban as KanbanIcon, Trash2, X,
  Store, Check, Settings2, Sparkles,
} from "lucide-react";
import { BoardView, type BoardField } from "@/components/board-view/board-view";
import { BoardHeaderActions } from "@/components/layout/board-header-actions";
import { EditColumnsDialog } from "@/components/studio/edit-columns-dialog";

type StudioField = {
  key: string;
  label: string;
  type: BoardField["fieldType"];
  options?: { choices?: { value: string; label?: string; color?: string }[] };
};

type StudioItem = {
  id: string;
  title: string;
  values: Record<string, unknown>;
  position: number;
  status: string | null;
  createdAt: string;
};

type StudioBoardData = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  layout: "TABLE" | "KANBAN";
  fields: StudioField[];
  productSlug: string | null;
  workspaceId: string | null;
  color: string | null;
  items: StudioItem[];
};

export default function StudioBoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [board, setBoard] = useState<StudioBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [publishVisibility, setPublishVisibility] = useState<"ORG" | "PUBLIC">("ORG");
  const [publishCategory, setPublishCategory] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [showEditCols, setShowEditCols] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/studio/boards/${slug}`);
      if (r.status === 404) {
        setNotFound(true);
        return;
      }
      if (!r.ok) return;
      const d = await r.json();
      setBoard(d.board);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleAdd = async () => {
    if (!newTitle.trim() || !board) return;
    setCreating(true);
    try {
      const r = await fetch(`/api/studio/boards/${slug}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (!r.ok) return;
      setNewTitle("");
      setShowAdd(false);
      await refresh();
    } finally {
      setCreating(false);
    }
  };

  const handleChangeField = useCallback(async (id: string, key: string, value: unknown) => {
    if (!board) return;
    // Title is its own column on StudioItem; everything else lives in values.
    const isTitle = key === "title";
    const isStatus = key === "status" && board.fields.some((f) => f.key === "status");
    const payload: Record<string, unknown> = { id };
    if (isTitle) payload.title = value;
    else if (isStatus) {
      payload.status = value;
      // Also stash inside values so the table shows it without special-casing.
      payload.values = { [key]: value };
    } else {
      payload.values = { [key]: value };
    }
    await fetch(`/api/studio/boards/${slug}/items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
    await refresh();
  }, [board, slug, refresh]);

  const handleDeleteBoard = async () => {
    if (!confirm("Delete this board and all its items? This can't be undone.")) return;
    setDeleting(true);
    try {
      await fetch(`/api/studio/boards/${slug}`, { method: "DELETE" });
      window.location.href = "/studio";
    } finally {
      setDeleting(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    setPublishResult(null);
    try {
      const r = await fetch(`/api/studio/boards/${slug}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visibility: publishVisibility,
          category: publishCategory.trim() || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setPublishResult(d.error || "Publish failed");
        return;
      }
      setPublishResult(
        publishVisibility === "PUBLIC"
          ? "Published to the public marketplace. Every org can now install it."
          : "Published to your org marketplace. Your team can install it from any workspace.",
      );
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-2 inline-flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" /> Loading board…
      </div>
    );
  }
  if (notFound || !board) {
    return (
      <div className="p-6 max-w-md">
        <Link href="/studio" className="text-xs text-violet-600 hover:text-violet-700 inline-flex items-center gap-1 mb-4">
          <ChevronLeft size={12} /> Back to Studio
        </Link>
        <h1 className="text-lg font-semibold mb-1">Board not found</h1>
        <p className="text-sm text-muted-2">
          The board &ldquo;{slug}&rdquo; doesn&rsquo;t exist or you don&rsquo;t have access.
        </p>
      </div>
    );
  }

  // Build the BoardField array: hoist `title` as the first column,
  // then merge the user-defined columns.
  const renderFields: BoardField[] = [
    { key: "title", label: "Name", fieldType: "TEXT" },
    ...(board.fields ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      fieldType: f.type,
      options: f.options,
    })),
  ];

  const editableKeys = renderFields.map((f) => f.key);

  return (
    <div className="p-6 max-w-[1800px] mx-auto">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="min-w-0 flex-1">
          <Link href="/studio" className="text-xs text-muted-2 hover:text-foreground inline-flex items-center gap-1 mb-2">
            <ChevronLeft size={12} /> Studio
          </Link>
          <div className="flex items-center gap-2">
            {board.layout === "KANBAN" ? (
              <KanbanIcon size={18} className="text-violet-600" />
            ) : (
              <TableIcon size={18} className="text-violet-600" />
            )}
            <h1 className="text-2xl font-semibold truncate">{board.name}</h1>
            <span className="text-xs text-muted-2 tabular-nums">{board.items.length}</span>
          </div>
          {board.description && (
            <p className="text-sm text-muted mt-1">{board.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/sidekick?context=studio&board=${slug}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/20 text-xs font-medium"
            title="Ask Sidekick about this board"
          >
            <Sparkles size={12} /> Ask AI
          </Link>
          <button
            type="button"
            onClick={() => setShowEditCols(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-muted hover:text-foreground hover:bg-surface-2 text-xs font-medium"
            title="Edit columns"
          >
            <Settings2 size={12} /> Columns
          </button>
          <button
            type="button"
            onClick={() => setShowPublish(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-muted hover:text-foreground hover:bg-surface-2 text-xs font-medium"
            title="Publish as marketplace template"
          >
            <Store size={12} /> Publish
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium"
          >
            <Plus size={12} /> New row
          </button>
          <BoardHeaderActions
            onActivityLog={() => {}}
            onSettings={() => {}}
            onDelete={handleDeleteBoard}
            extraMenuItems={
              deleting ? (
                <div className="px-2 py-1 text-xs text-muted-2 inline-flex items-center gap-1">
                  <Loader2 size={11} className="animate-spin" /> Deleting…
                </div>
              ) : undefined
            }
          />
        </div>
      </div>

      {board.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-violet-300/40 dark:border-violet-700/40 bg-gradient-to-br from-violet-50/40 to-transparent dark:from-violet-950/20 text-center py-20 px-6">
          <div className="inline-flex w-12 h-12 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-950/30 text-violet-600 mb-4">
            {board.layout === "KANBAN" ? <KanbanIcon size={20} /> : <TableIcon size={20} />}
          </div>
          <h2 className="text-base font-semibold mb-1">Your board is ready</h2>
          <p className="text-sm text-muted-2 mb-5 max-w-md mx-auto">
            Add rows to fill <span className="font-medium text-foreground">{board.name}</span> with real work. Tweak columns anytime — column edits don&rsquo;t drop your data.
          </p>
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium"
            >
              <Plus size={12} /> Add first row
            </button>
            <button
              type="button"
              onClick={() => setShowEditCols(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-muted hover:text-foreground hover:bg-surface text-xs font-medium"
            >
              <Settings2 size={12} /> Tune columns
            </button>
          </div>
          {(board.fields ?? []).length > 0 && (
            <p className="text-[11px] text-muted-2 mt-5">
              {board.fields.length} column{board.fields.length === 1 ? "" : "s"}:
              {" "}
              <span className="font-mono text-foreground/80">
                {board.fields.map((f) => f.label).join(" · ")}
              </span>
            </p>
          )}
        </div>
      ) : (
        <BoardView
          boardKey={`studio:${board.slug}`}
          items={board.items}
          fields={renderFields}
          getId={(i) => i.id}
          getTitle={(i) => i.title}
          getValue={(i, key) => {
            if (key === "title") return i.title;
            if (key === "status" && i.status !== null) return i.status;
            return (i.values as Record<string, unknown>)[key];
          }}
          editableFields={editableKeys}
          onChangeField={handleChangeField}
        />
      )}

      {showEditCols && (
        <EditColumnsDialog
          boardSlug={slug}
          initialFields={board.fields ?? []}
          onClose={() => setShowEditCols(false)}
          onSaved={async () => { setShowEditCols(false); await refresh(); }}
        />
      )}

      {showPublish && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => { if (!publishing) { setShowPublish(false); setPublishResult(null); } }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold inline-flex items-center gap-2">
                <Store size={16} /> Publish as template
              </h2>
              <button
                type="button"
                onClick={() => { setShowPublish(false); setPublishResult(null); }}
                className="p-1 rounded hover:bg-surface-2 text-muted"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-muted-2">
              Publishing snapshots the board&rsquo;s columns + layout (not its data) so other teams can install a fresh empty copy.
            </p>

            <div>
              <p className="text-xs font-medium text-muted-2 mb-1">Who can install this?</p>
              <div className="space-y-1">
                <label className={"flex items-start gap-2 p-2 rounded-md border cursor-pointer text-xs " +
                  (publishVisibility === "ORG" ? "border-violet-500 bg-violet-50 dark:bg-violet-950/20" : "border-border")}>
                  <input
                    type="radio"
                    name="visibility"
                    value="ORG"
                    checked={publishVisibility === "ORG"}
                    onChange={() => setPublishVisibility("ORG")}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium block">Your org only</span>
                    <span className="text-muted-2">Visible across your workspaces — teams in your org can install copies.</span>
                  </span>
                </label>
                <label className={"flex items-start gap-2 p-2 rounded-md border cursor-pointer text-xs " +
                  (publishVisibility === "PUBLIC" ? "border-violet-500 bg-violet-50 dark:bg-violet-950/20" : "border-border")}>
                  <input
                    type="radio"
                    name="visibility"
                    value="PUBLIC"
                    checked={publishVisibility === "PUBLIC"}
                    onChange={() => setPublishVisibility("PUBLIC")}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium block">Public marketplace</span>
                    <span className="text-muted-2">Every WorkwrK org can find + install it. Useful for community templates.</span>
                  </span>
                </label>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-2">Category (optional)</label>
              <input
                type="text"
                value={publishCategory}
                onChange={(e) => setPublishCategory(e.target.value)}
                placeholder="Sales, PM, HR, Onboarding…"
                className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-surface text-sm"
              />
            </div>

            {publishResult && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-700 dark:text-emerald-300 inline-flex items-start gap-2">
                <Check size={12} className="mt-0.5 flex-shrink-0" />
                <span>{publishResult}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowPublish(false); setPublishResult(null); }}
                disabled={publishing}
                className="px-3 py-1.5 rounded-md text-sm text-muted hover:bg-surface-2"
              >
                {publishResult ? "Done" : "Cancel"}
              </button>
              {!publishResult && (
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={publishing}
                  className="px-4 py-1.5 rounded-md text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {publishing ? <Loader2 size={12} className="animate-spin" /> : <Store size={12} />}
                  Publish
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => { if (!creating) { setShowAdd(false); setNewTitle(""); } }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">New row</h2>
              <button
                type="button"
                onClick={() => { setShowAdd(false); setNewTitle(""); }}
                className="p-1 rounded hover:bg-surface-2 text-muted"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim()) {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder="Row name"
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-xs text-muted-2">Tip: open the row after creating to fill in the other columns.</p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowAdd(false); setNewTitle(""); }}
                disabled={creating}
                className="px-3 py-1.5 rounded-md text-sm text-muted hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={creating || !newTitle.trim()}
                className="px-4 py-1.5 rounded-md text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
