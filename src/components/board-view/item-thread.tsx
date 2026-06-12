"use client";

// ItemThread — tabbed Comments + Activity strip rendered inside the
// BoardItemDrawer. Comments are user-authored via /api/items/[id]/
// updates; Activity is system-emitted via ItemActivity (we mirror new
// comments into the activity stream so a unified feed still works).
//
// Activity row rendering is heuristic per `action`:
//   CREATED         → "Mai created this row"
//   STATUS_CHANGED  → "Mai changed status from To Do → In Progress"
//   TITLE_CHANGED   → "Mai renamed row from Old to New"
//   OWNER_CHANGED   → "Mai changed owner"
//   FIELDS_UPDATED  → "Mai updated fields"
//   ARCHIVED        → "Mai archived this row"
//   COMMENTED       → "Mai commented"

import { useCallback, useEffect, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { DEFAULT_STATUS_OPTIONS, type StatusOption } from "@/lib/board-items-shared";
import type { ThreadActivity, ThreadUpdate } from "@/lib/item-thread";

type Tab = "comments" | "activity";

interface ItemThreadProps {
  itemId: string;
  canEdit: boolean;
  /** The current user's id — used to gate the "delete my comment" affordance. */
  currentUserId: string | null;
  /** Per-List statuses — resolves status values in activity rows to
   *  their labels. Falls back to the canonical default set. */
  statuses?: StatusOption[];
}

export function ItemThread({ itemId, canEdit, currentUserId, statuses }: ItemThreadProps) {
  const [tab, setTab] = useState<Tab>("comments");
  const [updates, setUpdates] = useState<ThreadUpdate[]>([]);
  const [activity, setActivity] = useState<ThreadActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, aRes] = await Promise.all([
        fetch(`/api/items/${itemId}/updates`, { cache: "no-store" }),
        fetch(`/api/items/${itemId}/activity`, { cache: "no-store" }),
      ]);
      if (uRes.ok) setUpdates((await uRes.json()).updates ?? []);
      if (aRes.ok) setActivity((await aRes.json()).activity ?? []);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => { void load(); }, [load]);

  const submit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${itemId}/updates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to post");
        return;
      }
      setDraft("");
      setUpdates((prev) => [...prev, data.update as ThreadUpdate]);
      // Pull activity (the post mirrors as COMMENTED).
      const aRes = await fetch(`/api/items/${itemId}/activity`, { cache: "no-store" });
      if (aRes.ok) setActivity((await aRes.json()).activity ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post");
    } finally {
      setPosting(false);
    }
  }, [itemId, draft]);

  const deleteComment = useCallback(async (updateId: string) => {
    if (!confirm("Delete this comment?")) return;
    try {
      const res = await fetch(`/api/items/${itemId}/updates/${updateId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to delete");
        return;
      }
      setUpdates((prev) => prev.filter((u) => u.id !== updateId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }, [itemId]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 border-b border-zinc-200">
        <TabButton active={tab === "comments"} onClick={() => setTab("comments")} label="Comments" count={updates.length} />
        <TabButton active={tab === "activity"} onClick={() => setTab("activity")} label="Activity" count={activity.length} />
      </div>

      {error ? <div className="text-xs text-red-500 mb-2">{error}</div> : null}

      {tab === "comments" ? (
        <CommentsTab
          updates={updates}
          loading={loading}
          canEdit={canEdit}
          currentUserId={currentUserId}
          draft={draft}
          setDraft={setDraft}
          posting={posting}
          onSubmit={submit}
          onDelete={deleteComment}
        />
      ) : (
        <ActivityTab activity={activity} loading={loading} statuses={statuses ?? [...DEFAULT_STATUS_OPTIONS]} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm py-2 -mb-px border-b-2 px-1 ${
        active
          ? "border-foreground text-zinc-900"
          : "border-transparent text-zinc-500 hover:text-zinc-900"
      }`}
    >
      {label} <span className="text-xs text-zinc-500">{count}</span>
    </button>
  );
}

function CommentsTab({
  updates,
  loading,
  canEdit,
  currentUserId,
  draft,
  setDraft,
  posting,
  onSubmit,
  onDelete,
}: {
  updates: ThreadUpdate[];
  loading: boolean;
  canEdit: boolean;
  currentUserId: string | null;
  draft: string;
  setDraft: (v: string) => void;
  posting: boolean;
  onSubmit: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {loading ? (
        <div className="text-xs text-zinc-500 py-2">Loading…</div>
      ) : updates.length === 0 ? (
        <div className="text-xs text-zinc-500 py-2">No comments yet.</div>
      ) : (
        <ul className="space-y-3">
          {updates.map((u) => {
            const initials = `${u.author?.firstName?.[0] ?? ""}${u.author?.lastName?.[0] ?? ""}`.toUpperCase() || "?";
            const canDelete = canEdit || (currentUserId && u.authorId === currentUserId);
            return (
              <li key={u.id} className="group flex gap-3">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-zinc-100 text-xs font-medium flex-shrink-0">
                  {initials}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium">
                      {u.author ? `${u.author.firstName} ${u.author.lastName}` : "Someone"}
                    </span>
                    <span className="text-zinc-500">{relativeTime(new Date(u.createdAt))}</span>
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => onDelete(u.id)}
                        className="opacity-0 group-hover:opacity-100 ml-auto inline-flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-red-500 hover:bg-red-500/10"
                        aria-label="Delete comment"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    ) : null}
                  </div>
                  <div className="text-sm whitespace-pre-wrap break-words mt-0.5">{u.body}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit ? (
        <div className="pt-2 border-t border-zinc-200">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              placeholder="Add a comment… (⌘+Enter to send)"
              rows={2}
              className="flex-1 px-3 py-2 rounded-md border border-zinc-200 bg-white text-sm resize-y focus:outline-none focus:border-[var(--os-brand)]"
            />
            <button
              type="button"
              onClick={onSubmit}
              disabled={posting || !draft.trim()}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md text-sm text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {posting ? "Posting…" : "Send"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActivityTab({ activity, loading, statuses }: { activity: ThreadActivity[]; loading: boolean; statuses: StatusOption[] }) {
  if (loading) return <div className="text-xs text-zinc-500 py-2">Loading…</div>;
  if (activity.length === 0) return <div className="text-xs text-zinc-500 py-2">No activity yet.</div>;
  return (
    <ul className="space-y-2">
      {activity.map((a) => {
        const actor = a.actor ? `${a.actor.firstName} ${a.actor.lastName}` : "System";
        const description = describeActivity(a, statuses);
        return (
          <li key={a.id} className="flex items-baseline gap-2 text-xs">
            <span className="text-zinc-500 whitespace-nowrap">{relativeTime(new Date(a.createdAt))}</span>
            <span className="flex-1 min-w-0">
              <span className="font-medium">{actor}</span> <span className="text-zinc-500">{description}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function describeActivity(a: ThreadActivity, statuses: StatusOption[]): string {
  const meta = a.meta;
  const statusLabel = (v: string) => statuses.find((o) => o.value === v)?.label ?? v;
  switch (a.action) {
    case "CREATED":
      return "created this row";
    case "STATUS_CHANGED": {
      const from = typeof meta.from === "string" ? statusLabel(meta.from) : "—";
      const to = typeof meta.to === "string" ? statusLabel(meta.to) : "—";
      return `changed status from ${from} → ${to}`;
    }
    case "TITLE_CHANGED": {
      const from = typeof meta.from === "string" ? meta.from : "";
      const to = typeof meta.to === "string" ? meta.to : "";
      return `renamed "${from}" → "${to}"`;
    }
    case "OWNER_CHANGED":
      return "changed the owner";
    case "FIELDS_UPDATED":
      return "updated fields";
    case "ARCHIVED":
      return "archived this row";
    case "COMMENTED":
      return "commented";
    default:
      return a.action.toLowerCase().replace(/_/g, " ");
  }
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
