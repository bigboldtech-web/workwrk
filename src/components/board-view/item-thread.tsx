"use client";

// ItemThread — tabbed Comments + Activity strip rendered inside the
// BoardItemDrawer. Comments are user-authored via /api/items/[id]/
// updates; Activity is system-emitted via ItemActivity (we mirror new
// comments into the activity stream so a unified feed still works).
//
// Composer supports @mentions: typing "@" opens a member typeahead
// (same /api/users source as AssigneePicker); picking someone inserts
// a plain-text "@First Last" token and the POST carries the picked
// mentionedUserIds so the server can fan out "mention" notifications.
// Rendered bodies chip-style any "@Capitalized [Capitalized]" token.
//
// Activity row rendering is heuristic per `action`:
//   CREATED         → "Mai created this row"
//   STATUS_CHANGED  → "Mai changed status from To Do → In Progress"
//   TITLE_CHANGED   → "Mai renamed row from Old to New"
//   OWNER_CHANGED   → "Mai changed owner"
//   FIELDS_UPDATED  → "Mai updated fields"
//   ARCHIVED        → "Mai archived this row"
//   COMMENTED       → "Mai commented"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pencil, Send, Trash2 } from "lucide-react";
import { ViewTabStrip, ViewTab } from "@/components/ui/view-tabs";
import { MenuItem } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/dialog-provider";
import { DEFAULT_STATUS_OPTIONS, type StatusOption } from "@/lib/board-items-shared";
import type { ThreadActivity, ThreadUpdate } from "@/lib/item-thread";
import { PersonAvatar, type PersonRef } from "./assignee-picker";

type Tab = "comments" | "activity";

/** A member picked from the @-typeahead for the current draft. */
interface MentionRef {
  id: string;
  name: string;
}

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
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("comments");
  const [updates, setUpdates] = useState<ThreadUpdate[]>([]);
  const [activity, setActivity] = useState<ThreadActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<MentionRef[]>([]);
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

  const registerMention = useCallback((m: MentionRef) => {
    setMentions((prev) => (prev.some((x) => x.id === m.id && x.name === m.name) ? prev : [...prev, m]));
  }, []);

  const submit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    // Only mentions whose "@Name" token survived editing get notified.
    const mentionedUserIds = [
      ...new Set(mentions.filter((m) => trimmed.includes(`@${m.name}`)).map((m) => m.id)),
    ];
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${itemId}/updates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: trimmed,
          ...(mentionedUserIds.length ? { mentionedUserIds } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to post");
        return;
      }
      setDraft("");
      setMentions([]);
      setUpdates((prev) => [...prev, data.update as ThreadUpdate]);
      // Pull activity (the post mirrors as COMMENTED).
      const aRes = await fetch(`/api/items/${itemId}/activity`, { cache: "no-store" });
      if (aRes.ok) setActivity((await aRes.json()).activity ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post");
    } finally {
      setPosting(false);
    }
  }, [itemId, draft, mentions]);

  const deleteComment = useCallback(async (updateId: string) => {
    if (!(await confirm({ title: "Delete comment", description: "Delete this comment?", destructive: true, confirmLabel: "Delete" }))) return;
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
  }, [itemId, confirm]);

  const editComment = useCallback(async (updateId: string, body: string): Promise<boolean> => {
    setError(null);
    try {
      const res = await fetch(`/api/items/${itemId}/updates/${updateId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to edit");
        return false;
      }
      setUpdates((prev) => prev.map((u) => (u.id === updateId ? (data.update as ThreadUpdate) : u)));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to edit");
      return false;
    }
  }, [itemId]);

  return (
    <div>
      <ViewTabStrip className="mb-2">
        <ViewTab
          active={tab === "comments"}
          onClick={() => setTab("comments")}
          label="Comments"
          trailing={<span className="text-xs text-zinc-500">{updates.length}</span>}
        />
        <ViewTab
          active={tab === "activity"}
          onClick={() => setTab("activity")}
          label="Activity"
          trailing={<span className="text-xs text-zinc-500">{activity.length}</span>}
        />
      </ViewTabStrip>

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
          onEditSave={editComment}
          onMention={registerMention}
        />
      ) : (
        <ActivityTab activity={activity} loading={loading} statuses={statuses ?? [...DEFAULT_STATUS_OPTIONS]} />
      )}
    </div>
  );
}

// Matches the "@First Last" tokens the typeahead inserts (capitalized
// word, optionally followed by one more). Purely presentational — the
// server only trusts the explicit mentionedUserIds list.
const MENTION_SPLIT_RE = /(@\p{Lu}[\p{L}\p{N}'’.-]*(?: \p{Lu}[\p{L}\p{N}'’.-]*)?)/gu;

function renderBody(body: string): ReactNode {
  const parts = body.split(MENTION_SPLIT_RE);
  if (parts.length === 1) return body;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span
        key={i}
        className="rounded bg-[var(--os-brand)]/10 px-1 py-px font-medium text-[var(--os-brand-ink)]"
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function personName(p: PersonRef): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Unknown";
}

/** Find an active "@query" token ending at the caret, if any. */
function detectMention(value: string, caret: number): { start: number; query: string } | null {
  const at = value.lastIndexOf("@", caret - 1);
  if (at < 0) return null;
  // "@" must start the text or follow whitespace/"(" so emails don't trigger.
  if (at > 0 && !/[\s(]/.test(value[at - 1])) return null;
  const token = value.slice(at + 1, caret);
  if (token.length > 40 || /[\n@]/.test(token)) return null;
  return { start: at, query: token };
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
  onEditSave,
  onMention,
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
  onEditSave: (id: string, body: string) => Promise<boolean>;
  onMention: (m: MentionRef) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const mentionOpen = mention !== null;
  const mentionQuery = mention?.query ?? "";

  // Debounced member search while the @-typeahead is open.
  useEffect(() => {
    if (!mentionOpen) return;
    let active = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ scope: "all", limit: "8" });
      if (mentionQuery.trim()) params.set("search", mentionQuery.trim());
      fetch(`/api/users?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((d) => {
          if (!active) return;
          setPeople(Array.isArray(d?.data) ? d.data : []);
          setActiveIdx(0);
        })
        .catch(() => { if (active) setPeople([]); });
    }, 200);
    return () => { active = false; clearTimeout(t); };
  }, [mentionOpen, mentionQuery]);

  const closeMention = useCallback(() => {
    setMention(null);
    setPeople([]);
  }, []);

  const syncMention = useCallback((value: string) => {
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const next = detectMention(value, caret);
    setMention(next);
    if (!next) setPeople([]);
  }, []);

  const pickMention = useCallback((p: PersonRef) => {
    if (!mention) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? mention.start + 1 + mention.query.length;
    const name = personName(p);
    setDraft(`${draft.slice(0, mention.start)}@${name} ${draft.slice(caret)}`);
    onMention({ id: p.id, name });
    setMention(null);
    setPeople([]);
    const pos = mention.start + name.length + 2; // after "@Name "
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }, [mention, draft, setDraft, onMention]);

  const startEdit = useCallback((u: ThreadUpdate) => {
    setEditingId(u.id);
    setEditDraft(u.body);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    const trimmed = editDraft.trim();
    if (!trimmed) return;
    setSavingEdit(true);
    const ok = await onEditSave(editingId, trimmed);
    setSavingEdit(false);
    if (ok) setEditingId(null);
  }, [editingId, editDraft, onEditSave]);

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
            const isOwn = Boolean(currentUserId && u.authorId === currentUserId);
            const canDelete = canEdit || isOwn;
            const isEditing = editingId === u.id;
            const wasEdited =
              new Date(u.updatedAt).getTime() - new Date(u.createdAt).getTime() > 5_000;
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
                    {wasEdited ? <span className="text-zinc-400">(edited)</span> : null}
                    <span className="ml-auto inline-flex items-center gap-0.5">
                      {isOwn && !isEditing ? (
                        <button
                          type="button"
                          onClick={() => startEdit(u)}
                          className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100"
                          aria-label="Edit comment"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => onDelete(u.id)}
                          className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-red-500 hover:bg-red-500/10"
                          aria-label="Delete comment"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      ) : null}
                    </span>
                  </div>
                  {isEditing ? (
                    <div className="mt-1">
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            void saveEdit();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setEditingId(null);
                          }
                        }}
                        rows={2}
                        autoFocus
                        className="w-full px-3 py-2 rounded-md border border-zinc-200 bg-white text-sm resize-y focus:outline-none focus:border-[var(--os-brand)]"
                      />
                      <div className="flex items-center gap-1.5 mt-1">
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={savingEdit || !editDraft.trim()}
                          className="h-6 px-2.5 rounded-md text-xs text-white bg-[var(--os-brand)] hover:bg-[var(--os-brand-hover)] disabled:opacity-50"
                        >
                          {savingEdit ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="h-6 px-2.5 rounded-md text-xs text-zinc-600 hover:bg-zinc-100"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm whitespace-pre-wrap break-words mt-0.5">{renderBody(u.body)}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit ? (
        <div className="pt-2 border-t border-zinc-200">
          <div className="flex items-end gap-2">
            <div className="relative flex-1">
              {mentionOpen && people.length > 0 ? (
                <div
                  className="absolute bottom-full left-0 mb-1 w-64 max-h-[240px] overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-2xl z-[200] py-1.5"
                  // Keep textarea focus when clicking a row.
                  onMouseDown={(e) => e.preventDefault()}
                  role="listbox"
                >
                  {people.map((p, i) => (
                    <MenuItem
                      key={p.id}
                      leading={<PersonAvatar person={p} size={22} />}
                      label={personName(p)}
                      active={i === activeIdx}
                      onClick={() => pickMention(p)}
                      role="option"
                    />
                  ))}
                </div>
              ) : null}
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  syncMention(e.target.value);
                }}
                onClick={() => syncMention(draft)}
                onBlur={closeMention}
                onKeyDown={(e) => {
                  if (mentionOpen && people.length > 0 && !e.metaKey && !e.ctrlKey) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActiveIdx((i) => (i + 1) % people.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActiveIdx((i) => (i - 1 + people.length) % people.length);
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      pickMention(people[activeIdx] ?? people[0]);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      closeMention();
                      return;
                    }
                  }
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    onSubmit();
                  }
                }}
                placeholder="Add a comment… @ to mention (⌘+Enter to send)"
                rows={2}
                className="w-full px-3 py-2 rounded-md border border-zinc-200 bg-white text-sm resize-y focus:outline-none focus:border-[var(--os-brand)]"
              />
            </div>
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
