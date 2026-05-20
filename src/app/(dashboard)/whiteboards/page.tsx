"use client";

// Whiteboards — list page. Excalidraw-powered canvases for mind maps,
// diagrams, brainstorms, retros. Each card shows thumbnail + name +
// last-edited time. Click to open the canvas.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PenTool, Plus, X, Zap, Clock } from "lucide-react";

type Whiteboard = {
  id: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  ownerId: string | null;
  lastEditedAt: string | null;
  productSlug: string | null;
  createdAt: string;
  updatedAt: string;
};

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function WhiteboardsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Whiteboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whiteboards");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.whiteboards ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300 text-xs font-medium mb-3">
            <PenTool size={12} />
            Whiteboards
          </div>
          <h1 className="text-2xl font-semibold mb-1">Whiteboards</h1>
          <p className="text-sm text-muted">Mind maps · diagrams · sketches · retro boards — infinite canvas powered by Excalidraw</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-sm font-medium"
        >
          <Plus size={14} />
          New whiteboard
        </button>
      </div>

      {loading ? (
        <div className="text-center text-sm text-muted py-20">Loading whiteboards…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface text-center py-20">
          <PenTool size={40} className="mx-auto mb-3 text-muted-2" />
          <p className="font-medium mb-1">No whiteboards yet</p>
          <p className="text-sm text-muted mb-4 max-w-sm mx-auto">Sketch ideas, draw mind maps, run retros, diagram systems — all on an infinite canvas.</p>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-700 text-white text-sm font-medium"
          >
            <Plus size={14} /> Create first whiteboard
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((w) => (
            <Link
              key={w.id}
              href={`/whiteboards/${w.id}`}
              className="group rounded-xl border border-border bg-surface hover:border-pink-300 transition-colors overflow-hidden"
            >
              <div className="aspect-[4/3] bg-surface-2 flex items-center justify-center overflow-hidden">
                {w.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.thumbnail} alt={w.name} className="w-full h-full object-cover" />
                ) : (
                  <PenTool size={28} className="text-muted-2" />
                )}
              </div>
              <div className="p-3">
                <div className="font-medium text-sm mb-0.5 truncate">{w.name}</div>
                {w.description && <p className="text-xs text-muted line-clamp-1 mb-1">{w.description}</p>}
                <div className="flex items-center gap-1 text-[11px] text-muted-2">
                  <Clock size={10} />
                  {timeAgo(w.lastEditedAt ?? w.updatedAt)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showNew && (
        <NewBoardModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            router.push(`/whiteboards/${id}`);
          }}
        />
      )}
    </div>
  );
}

function NewBoardModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/whiteboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description || undefined }),
      });
      if (!res.ok) return;
      const data = await res.json();
      onCreated(data.whiteboard.id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-surface border border-border shadow-xl p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">New whiteboard</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-muted"><X size={16} /></button>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-2 mb-1">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Q1 product brainstorm"
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-2 mb-1">Description (optional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
          />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface-2">Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-pink-600 hover:bg-pink-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving ? "Creating…" : (<><Zap size={12} /> Create &amp; open</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
