"use client";

// ItemActivityDrawer — Phase 5. Right-side panel with three tabs:
// Updates · Files · Activity. Matches monday's per-row drawer.
//
// Updates: rich text composer + feed (user-authored).
// Activity: read-only auto-log feed (status changes, assignments).
// Files: placeholder for v1 — most modules already have their own
//        attachment surface; we'll unify in a later phase.

import { useCallback, useEffect, useState } from "react";
import {
  X, MessageCircle, FileText, Activity as ActivityIcon, Loader2,
  Trash2, Paperclip,
} from "lucide-react";
import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog-provider";

interface UpdateRow {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
  createdAt: string;
}

interface ActivityRow {
  id: string;
  action: string;
  meta: Record<string, unknown>;
  actorId: string | null;
  actorName: string | null;
  actorImage: string | null;
  createdAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Polymorphic entity tuple — e.g. ("LEAD", lead.id). */
  entityType: string;
  entityId: string;
  /** Header title. */
  title: string;
}

type Tab = "updates" | "files" | "activity";

export function ItemActivityDrawer(props: Props) {
  const { open, onClose, entityType, entityId, title } = props;
  const toast = useToast();
  const confirm = useConfirm();

  const [tab, setTab] = useState<Tab>("updates");
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [composer, setComposer] = useState("");
  const [posting, setPosting] = useState(false);

  const loadUpdates = useCallback(async () => {
    if (!open) return;
    setLoadingUpdates(true);
    try {
      const res = await fetch(`/api/item-updates?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`);
      if (res.ok) {
        const data = await res.json();
        setUpdates(data.updates ?? []);
      }
    } finally {
      setLoadingUpdates(false);
    }
  }, [open, entityType, entityId]);

  const loadActivity = useCallback(async () => {
    if (!open) return;
    setLoadingActivity(true);
    try {
      const res = await fetch(`/api/item-activity?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`);
      if (res.ok) {
        const data = await res.json();
        setActivity(data.activity ?? []);
      }
    } finally {
      setLoadingActivity(false);
    }
  }, [open, entityType, entityId]);

  useEffect(() => { if (tab === "updates") loadUpdates(); }, [tab, loadUpdates]);
  useEffect(() => { if (tab === "activity") loadActivity(); }, [tab, loadActivity]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submitUpdate = useCallback(async () => {
    const body = composer.trim();
    if (!body) return;
    setPosting(true);
    try {
      const res = await fetch("/api/item-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityId, body }),
      });
      if (!res.ok) throw new Error();
      setComposer("");
      loadUpdates();
    } catch {
      toast.error("Couldn't post update");
    } finally {
      setPosting(false);
    }
  }, [composer, entityType, entityId, loadUpdates, toast]);

  const deleteUpdate = useCallback(async (id: string) => {
    if (!(await confirm({ title: "Archive update", description: "Archive this update? It will be hidden but kept in history.", destructive: true, confirmLabel: "Archive" }))) return;
    try {
      const res = await fetch(`/api/item-updates/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      loadUpdates();
    } catch {
      toast.error("Couldn't archive");
    }
  }, [loadUpdates, toast, confirm]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close activity drawer"
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside className="relative h-full w-full max-w-[460px] bg-white border-l border-zinc-200 shadow-2xl flex flex-col">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-zinc-200">
          <h2 className="flex-1 text-base font-semibold truncate">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-zinc-50 text-zinc-500-2 hover:text-zinc-900"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <ViewTabStrip className="flex-shrink-0 px-5">
          <ViewTab active={tab === "updates"} onClick={() => setTab("updates")} icon={MessageCircle} label="Updates" trailing={<CountBadge count={updates.length} />} />
          <ViewTab active={tab === "files"} onClick={() => setTab("files")} icon={FileText} label="Files" />
          <ViewTab active={tab === "activity"} onClick={() => setTab("activity")} icon={ActivityIcon} label="Activity Log" trailing={<CountBadge count={activity.length} />} />
        </ViewTabStrip>

        <div className="flex-1 overflow-y-auto">
          {tab === "updates" && (
            <UpdatesTab
              updates={updates}
              loading={loadingUpdates}
              composer={composer}
              setComposer={setComposer}
              posting={posting}
              onSubmit={submitUpdate}
              onDelete={deleteUpdate}
            />
          )}
          {tab === "files" && <FilesPlaceholder />}
          {tab === "activity" && <ActivityTab activity={activity} loading={loadingActivity} />}
        </div>
      </aside>
    </div>
  );
}

function CountBadge({ count }: { count?: number }) {
  if (count === undefined || count <= 0) return null;
  return (
    <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] bg-zinc-50 text-zinc-500-2">{count}</span>
  );
}

function UpdatesTab({
  updates, loading, composer, setComposer, posting, onSubmit, onDelete,
}: {
  updates: UpdateRow[];
  loading: boolean;
  composer: string;
  setComposer: (v: string) => void;
  posting: boolean;
  onSubmit: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="p-4 space-y-4">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <textarea
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          placeholder="Write a new update — mention a teammate with @, attach a file, share progress…"
          rows={3}
          className="w-full bg-transparent text-sm outline-none resize-none placeholder-muted-2"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between pt-2 mt-2 border-t border-zinc-200">
          <p className="text-[10px] text-zinc-500-2">⌘/Ctrl + Enter to post</p>
          <button
            type="button"
            onClick={onSubmit}
            disabled={posting || !composer.trim()}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {posting ? <Loader2 size={12} className="animate-spin" /> : null}
            Update
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-zinc-500-2 text-center py-8 inline-flex items-center gap-2 w-full justify-center">
          <Loader2 size={12} className="animate-spin" /> Loading updates…
        </p>
      ) : updates.length === 0 ? (
        <div className="text-center py-12">
          <MessageCircle size={32} className="mx-auto text-zinc-500-2 mb-3" />
          <p className="text-sm font-medium mb-1">No updates yet</p>
          <p className="text-xs text-zinc-500-2">Share progress, mention a teammate, or attach a file to get things moving.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {updates.map((u) => (
            <li key={u.id} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex items-start gap-2 mb-2">
                <Avatar name={u.authorName} image={u.authorImage} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium">{u.authorName ?? "Unknown"}</p>
                  <p className="text-[10px] text-zinc-500-2">{fmtAbs(new Date(u.createdAt))}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(u.id)}
                  className="p-1 rounded text-zinc-500-2 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  aria-label="Archive"
                  title="Archive (keeps history)"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="text-sm whitespace-pre-wrap">{u.body}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilesPlaceholder() {
  return (
    <div className="p-8 text-center">
      <Paperclip size={32} className="mx-auto text-zinc-500-2 mb-3" />
      <p className="text-sm font-medium mb-1">Files coming soon</p>
      <p className="text-xs text-zinc-500-2">
        Most modules already have their own attachment surface — we&apos;re unifying them into this tab in a later polish phase.
      </p>
    </div>
  );
}

function ActivityTab({ activity, loading }: { activity: ActivityRow[]; loading: boolean }) {
  if (loading) {
    return (
      <p className="text-xs text-zinc-500-2 text-center py-12 inline-flex items-center gap-2 w-full justify-center">
        <Loader2 size={12} className="animate-spin" /> Loading…
      </p>
    );
  }
  if (activity.length === 0) {
    return (
      <div className="text-center py-12 px-6">
        <ActivityIcon size={32} className="mx-auto text-zinc-500-2 mb-3" />
        <p className="text-sm font-medium mb-1">No activity yet</p>
        <p className="text-xs text-zinc-500-2">Every field change, owner assignment, and status flip will land here automatically.</p>
      </div>
    );
  }
  return (
    <ul className="p-4 space-y-2">
      {activity.map((a) => (
        <li key={a.id} className="flex items-start gap-2 text-xs">
          <Avatar name={a.actorName} image={a.actorImage} small />
          <div className="flex-1 min-w-0 pt-1">
            <p>
              <span className="font-medium">{a.actorName ?? "System"}</span>{" "}
              <span className="text-zinc-500-2">{renderActivity(a)}</span>
            </p>
            <p className="text-[10px] text-zinc-500-2 mt-0.5">{fmtAbs(new Date(a.createdAt))}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function renderActivity(a: ActivityRow) {
  const meta = a.meta || {};
  switch (a.action) {
    case "CREATED":
      return "created this item";
    case "STATUS_CHANGED":
      return `changed status: ${String(meta.from ?? "—")} → ${String(meta.to ?? "—")}`;
    case "PRIORITY_CHANGED":
      return `changed priority: ${String(meta.from ?? "—")} → ${String(meta.to ?? "—")}`;
    case "ASSIGNED":
      return `assigned to ${String(meta.toName ?? meta.to ?? "someone")}`;
    case "FIELD_UPDATED":
      return `updated ${String(meta.field ?? "a field")}`;
    case "COMMENT_ADDED":
      return "added a comment";
    case "ARCHIVED":
      return "archived this item";
    default:
      return a.action.toLowerCase().replace(/_/g, " ");
  }
}

function Avatar({ name, image, small }: { name: string | null; image: string | null; small?: boolean }) {
  const dim = small ? "w-5 h-5 text-[9px]" : "w-7 h-7 text-[11px]";
  if (image) {
    return <img src={image} alt={name ?? ""} className={`${dim} rounded-full object-cover`} />;
  }
  const initial = (name ?? "?").trim().charAt(0).toUpperCase();
  return (
    <span className={`${dim} rounded-full bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 inline-flex items-center justify-center font-semibold flex-shrink-0`}>
      {initial}
    </span>
  );
}

function fmtAbs(d: Date) {
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
