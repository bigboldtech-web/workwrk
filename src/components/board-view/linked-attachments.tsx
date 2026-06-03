"use client";

// LinkedAttachments — small panel that shows notes + whiteboards attached
// to any entity via EntityLink, with "+ Add" affordances. Lives inside
// the BoardItemDrawer today; designed so the same component drops into
// any drawer/page that has an entity context.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Frame, Plus, X, ExternalLink, Loader2 } from "lucide-react";

type EntityType = "BOARD_ITEM" | "TASK" | "BOARD" | "SPACE" | "KRA" | "KPI" | "SOP";

interface HydratedLink {
  id: string;
  targetType: string;
  targetId: string;
  target?: { title: string | null; subtitle?: string | null };
}

interface Props {
  sourceType: EntityType;
  sourceId: string;
  canEdit: boolean;
}

export function LinkedAttachments({ sourceType, sourceId, canEdit }: Props) {
  const [notes, setNotes] = useState<HydratedLink[] | null>(null);
  const [boards, setBoards] = useState<HydratedLink[] | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch(`/api/entity-links?sourceType=${sourceType}&sourceId=${sourceId}&filterTargetType=NOTE`).then((r) => r.json()).catch(() => ({ links: [] })),
      fetch(`/api/entity-links?sourceType=${sourceType}&sourceId=${sourceId}&filterTargetType=DOC`).then((r) => r.json()).catch(() => ({ links: [] })),
      fetch(`/api/entity-links?sourceType=${sourceType}&sourceId=${sourceId}&filterTargetType=WHITEBOARD`).then((r) => r.json()).catch(() => ({ links: [] })),
    ]).then(([noteRes, docRes, wbRes]) => {
      setNotes([...(noteRes.links ?? []), ...(docRes.links ?? [])]);
      setBoards(wbRes.links ?? []);
    });
  }, [sourceType, sourceId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <LinkSection
        title="Notes"
        Icon={FileText}
        items={notes}
        canEdit={canEdit}
        emptyHint="Attach a doc that explains context, decisions, or references."
        onAdd={async (title) => {
          const docRes = await fetch("/api/docs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title }),
          });
          const data = await docRes.json();
          const docId = data?.doc?.id;
          if (!docId) throw new Error("Could not create note");
          await fetch("/api/entity-links", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              source: { type: sourceType, id: sourceId },
              target: { type: "NOTE", id: docId },
            }),
          });
          await load();
        }}
        onRemove={async (id) => {
          await fetch(`/api/entity-links/${id}`, { method: "DELETE" });
          await load();
        }}
        onOpen={(targetId) => `/docs/${targetId}`}
      />

      <LinkSection
        title="Whiteboards"
        Icon={Frame}
        items={boards}
        canEdit={canEdit}
        emptyHint="Sketch a flow, diagram, or retro — drop it in for context."
        onAdd={async (name) => {
          const wbRes = await fetch("/api/whiteboards", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name }),
          });
          const data = await wbRes.json();
          const wbId = data?.whiteboard?.id;
          if (!wbId) throw new Error("Could not create whiteboard");
          await fetch("/api/entity-links", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              source: { type: sourceType, id: sourceId },
              target: { type: "WHITEBOARD", id: wbId },
            }),
          });
          await load();
        }}
        onRemove={async (id) => {
          await fetch(`/api/entity-links/${id}`, { method: "DELETE" });
          await load();
        }}
        onOpen={(targetId) => `/whiteboards/${targetId}`}
      />
    </div>
  );
}

function LinkSection({
  title,
  Icon,
  items,
  canEdit,
  emptyHint,
  onAdd,
  onRemove,
  onOpen,
}: {
  title: string;
  Icon: typeof FileText;
  items: HydratedLink[] | null;
  canEdit: boolean;
  emptyHint: string;
  onAdd: (title: string) => Promise<void>;
  onRemove: (linkId: string) => Promise<void>;
  onOpen: (targetId: string) => string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const commit = async () => {
    const v = draft.trim();
    if (!v) {
      setAdding(false);
      return;
    }
    setBusy(true);
    try {
      await onAdd(v);
      setDraft("");
      setAdding(false);
    } catch {
      // surface gracefully — drawer should keep state
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
          <Icon className="h-3 w-3" />
          {title}
          {items ? <span className="text-zinc-400 normal-case font-normal">· {items.length}</span> : null}
        </h3>
        {canEdit && !adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-[11px] text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-1"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="mb-2 flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit();
              if (e.key === "Escape") { setDraft(""); setAdding(false); }
            }}
            placeholder={`New ${title.toLowerCase().replace(/s$/, "")} title…`}
            className="flex-1 h-8 px-2 rounded-md border border-zinc-200 bg-white text-sm focus:outline-none focus:border-zinc-400"
            autoFocus
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => void commit()}
            disabled={busy || !draft.trim()}
            className="h-8 px-2.5 rounded-md bg-zinc-900 text-white text-xs font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
          </button>
          <button
            type="button"
            onClick={() => { setDraft(""); setAdding(false); }}
            disabled={busy}
            className="h-8 w-8 rounded-md hover:bg-zinc-100 inline-flex items-center justify-center text-zinc-500"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {items === null ? (
        <div className="text-xs text-zinc-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-zinc-400 leading-relaxed">{emptyHint}</div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li
              key={it.id}
              className="group flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 hover:bg-zinc-50"
            >
              <Icon className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <button
                type="button"
                onClick={() => router.push(onOpen(it.targetId))}
                className="flex-1 min-w-0 text-left text-sm font-medium truncate hover:text-zinc-700"
              >
                {it.target?.title || "Untitled"}
              </button>
              <button
                type="button"
                onClick={() => router.push(onOpen(it.targetId))}
                className="opacity-0 group-hover:opacity-100 h-6 w-6 rounded hover:bg-zinc-100 inline-flex items-center justify-center text-zinc-400"
                aria-label="Open"
              >
                <ExternalLink className="h-3 w-3" />
              </button>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => void onRemove(it.id)}
                  className="opacity-0 group-hover:opacity-100 h-6 w-6 rounded hover:bg-red-50 inline-flex items-center justify-center text-zinc-400 hover:text-red-500"
                  aria-label="Remove link"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
