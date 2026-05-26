"use client";

/* OsItemDetail — shared scaffolding for module item detail pages.
 *
 * Renders the full-page equivalent of the drawer:
 *   • Title bar (icon · back link · title · share · more)
 *   • Inline-editable title input
 *   • Field panel (caller supplies the fields array)
 *   • Tabs: Updates / Activity (Activity is a sample-placeholder for now)
 *   • Comments thread + composer (optional; supply commentsEndpoint)
 *
 * Each module's `[id]/page.tsx` is a thin wrapper that fetches its
 * item, transforms it into the fields array, and hands the result here.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Star, Share2, MoreHorizontal, MessageCircle, History,
  Send, Paperclip, Smile, AtSign,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { OsPickerPopover, type PickerOption } from "./picker-popover";
import { useOsShell } from "./shell-context";
import { useOsToast } from "./toast";
import { C } from "./catalog";

export type DetailField = {
  label: string;
  /** Pre-rendered value. Use a button if interactive. */
  value: React.ReactNode;
};

export type DetailComment = {
  id: string;
  body: string;
  createdAt: string;
  author?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

export type OsItemDetailProps = {
  /** Routing */
  backHref: string;
  backLabel: string;
  /** Visual header */
  Icon: LucideIcon;
  iconGradient: string;
  /** Identity */
  moduleId: string;          // bumps row-version on save
  itemId: string;
  title: string;
  /** Inline title-edit handler. If absent, the input is read-only. */
  onRenameSave?: (next: string) => Promise<boolean>;
  /** Top-right status pill (optional). */
  status?: { label: string; color: string };
  statusOptions?: PickerOption[];
  activeStatusValue?: string;
  onStatusPick?: (value: string) => Promise<boolean>;
  /** Field panel */
  fields: DetailField[];
  /** Optional comments thread */
  commentsListUrl?: string;  // GET; expected shape: array or { data: [...] }
  commentsPostUrl?: string;  // POST { body }
  /** Description shown above the comments (e.g. task.description) */
  description?: string | null;
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_PALETTE[h % AV_PALETTE.length];
}
function fmtRelative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function OsItemDetail({
  backHref, backLabel, Icon, iconGradient,
  moduleId, itemId, title, onRenameSave,
  status, statusOptions, activeStatusValue, onStatusPick,
  fields, commentsListUrl, commentsPostUrl, description,
}: OsItemDetailProps) {
  const router = useRouter();
  const { bumpRowVersion } = useOsShell();
  const { toast } = useOsToast();
  const [tab, setTab] = useState<"updates" | "activity">("updates");
  const [titleDraft, setTitleDraft] = useState(title);
  const [comments, setComments] = useState<DetailComment[] | null>(null);
  const [composer, setComposer] = useState("");
  const [posting, setPosting] = useState(false);
  const [picker, setPicker] = useState<{ rect: DOMRect } | null>(null);

  useEffect(() => { setTitleDraft(title); }, [title]);

  const loadComments = useCallback(async () => {
    if (!commentsListUrl) return;
    try {
      const res = await fetch(commentsListUrl);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: DetailComment[] = Array.isArray(data) ? data : (data.data ?? []);
      setComments(list);
    } catch {
      setComments([]);
    }
  }, [commentsListUrl]);

  useEffect(() => { void loadComments(); }, [loadComments]);

  async function postComment() {
    if (!commentsPostUrl || !composer.trim() || posting) return;
    const text = composer.trim();
    setComposer("");
    setPosting(true);
    const tempId = `temp-${Date.now()}`;
    setComments((c) => [
      ...(c ?? []),
      { id: tempId, body: text, createdAt: new Date().toISOString(), author: { id: "you", firstName: "You", lastName: "" } },
    ]);
    try {
      const res = await fetch(commentsPostUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const created: DetailComment = data.data ?? data;
      setComments((c) => (c ?? []).map((x) => x.id === tempId ? created : x));
      toast("Update posted");
    } catch {
      setComments((c) => (c ?? []).filter((x) => x.id !== tempId));
      setComposer(text);
      toast("Couldn't post");
    } finally {
      setPosting(false);
    }
  }

  function copyLink() {
    if (typeof window === "undefined") return;
    void navigator.clipboard.writeText(window.location.href).then(
      () => toast("Link copied"),
      () => toast("Couldn't copy"),
    );
  }

  return (
    <>
      {/* Title bar */}
      <div className="os-title-bar">
        <Link href={backHref} className="os-title-bar__btn" aria-label={`Back to ${backLabel}`} style={{ height: 32, padding: "0 10px" }}>
          <ArrowLeft />
          <span>{backLabel}</span>
        </Link>
        <div style={{ width: 1, height: 24, background: "var(--os-line)", margin: "0 4px" }} />
        <div className="os-title-bar__icon" style={{ background: iconGradient }}>
          <Icon />
        </div>
        <div className="os-title-bar__main">
          <span className="os-title-bar__name">{titleDraft || "(untitled)"}</span>
          <button type="button" className="os-title-bar__star" aria-label="Star"><Star /></button>
        </div>
        <div className="os-title-bar__spacer" />
        <button type="button" className="os-title-bar__btn" onClick={copyLink}>
          <Share2 />
          <span>Copy link</span>
        </button>
        <button type="button" className="os-title-bar__btn" aria-label="More"><MoreHorizontal /></button>
      </div>

      {/* Tabs */}
      <div className="os-tabs">
        <button type="button" className={`os-tab ${tab === "updates" ? "is-active" : ""}`} onClick={() => setTab("updates")}>
          <MessageCircle />
          <span>Updates</span>
          {comments ? <span style={{ fontSize: 10, fontWeight: 700, color: "var(--os-ink-3)" }}>{comments.length}</span> : null}
        </button>
        <button type="button" className={`os-tab ${tab === "activity" ? "is-active" : ""}`} onClick={() => setTab("activity")}>
          <History />
          <span>Activity</span>
        </button>
      </div>

      <div style={{ maxWidth: 920, margin: "0 auto", padding: "24px 32px 80px", width: "100%" }}>
        {/* Inline title */}
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={async () => {
            const t = titleDraft.trim();
            if (!onRenameSave || !t || t === title) return;
            const ok = await onRenameSave(t);
            if (ok) {
              toast("Renamed");
              bumpRowVersion(moduleId);
              router.refresh();
            } else {
              setTitleDraft(title);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") { setTitleDraft(title); (e.target as HTMLInputElement).blur(); }
          }}
          aria-label="Item title"
          readOnly={!onRenameSave}
          style={{
            width: "100%",
            fontFamily: "var(--os-font)",
            fontSize: 28,
            fontWeight: 700,
            color: "var(--os-ink)",
            letterSpacing: "-0.02em",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: 6,
            padding: "6px 10px",
            margin: "0 -10px 20px",
            outline: "none",
          }}
          onFocus={(e) => { if (onRenameSave) { e.currentTarget.style.borderColor = "var(--os-brand)"; e.currentTarget.style.background = "var(--os-canvas)"; } }}
        />

        {/* Status pill above the field panel (when caller supplied one) */}
        {status ? (
          <div style={{ marginBottom: 18 }}>
            <button
              type="button"
              className="os-drawer__field-pill"
              style={{
                background: status.color,
                color: status.color === C.yellow ? C.indigo : "white",
                cursor: statusOptions && onStatusPick ? "pointer" : "default",
                border: "none",
                fontSize: 13,
                padding: "4px 14px",
              }}
              onClick={(e) => {
                if (!statusOptions || !onStatusPick) return;
                setPicker({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
              }}
            >
              {status.label}
            </button>
          </div>
        ) : null}

        {/* Field panel */}
        <div className="os-drawer__fields" style={{ marginBottom: 22 }}>
          {fields.map((f) => (
            <div key={f.label} className="os-drawer__field">
              <span className="os-drawer__field-label">{f.label}</span>
              <span className="os-drawer__field-value">{f.value}</span>
            </div>
          ))}
          {description ? (
            <div className="os-drawer__field" style={{ gridColumn: "1 / -1" }}>
              <span className="os-drawer__field-label">Description</span>
              <span className="os-drawer__field-value" style={{ display: "block", fontSize: 13, lineHeight: 1.55, color: "var(--os-ink)" }}>
                {description}
              </span>
            </div>
          ) : null}
        </div>

        {tab === "updates" ? (
          <>
            <h3 className="os-drawer__section-title">
              <MessageCircle />
              Updates
              <span style={{ fontWeight: 500, color: "var(--os-ink-3)", marginLeft: 6 }}>
                {comments?.length ?? 0}
              </span>
            </h3>

            {!commentsListUrl ? (
              <div style={{ padding: "20px 0", color: "var(--os-ink-3)", fontSize: 13, textAlign: "center" }}>
                Updates aren't wired for this module yet — coming soon.
              </div>
            ) : !comments ? (
              <div style={{ padding: "20px 0", color: "var(--os-ink-3)", fontSize: 13, textAlign: "center" }}>
                Loading…
              </div>
            ) : comments.length === 0 ? (
              <div style={{ padding: "20px 0", color: "var(--os-ink-3)", fontSize: 13, textAlign: "center" }}>
                No updates yet. Start the conversation below.
              </div>
            ) : (
              comments.map((u) => {
                const initials = u.author
                  ? ((u.author.firstName?.[0] ?? "") + (u.author.lastName?.[0] ?? "")).toUpperCase() || "?"
                  : "?";
                const color = avatarFor(u.author?.id ?? u.id);
                const name = u.author ? `${u.author.firstName ?? ""} ${u.author.lastName ?? ""}`.trim() || "Unknown" : "Unknown";
                return (
                  <div key={u.id} className="os-drawer__update">
                    <span className="os-av os-av--md" style={{ background: color }}>{initials}</span>
                    <div className="os-drawer__update-body">
                      <div className="os-drawer__update-head">
                        <span className="os-drawer__update-author">{name}</span>
                        <span className="os-drawer__update-time">{fmtRelative(u.createdAt)}</span>
                      </div>
                      <div className="os-drawer__update-text" style={{ whiteSpace: "pre-wrap" }}>{u.body}</div>
                    </div>
                  </div>
                );
              })
            )}

            {commentsPostUrl ? (
              <div className="os-drawer__composer" style={{ marginTop: 18 }}>
                <textarea
                  className="os-drawer__composer-input"
                  placeholder="Write an update… ⌘⏎ to send"
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void postComment(); }
                  }}
                  disabled={posting}
                />
                <div className="os-drawer__composer-foot">
                  <button type="button" className="os-drawer__composer-icon" aria-label="Attach"><Paperclip /></button>
                  <button type="button" className="os-drawer__composer-icon" aria-label="Emoji"><Smile /></button>
                  <button type="button" className="os-drawer__composer-icon" aria-label="Mention"><AtSign /></button>
                  <button
                    type="button"
                    className="os-drawer__composer-send"
                    onClick={() => void postComment()}
                    disabled={!composer.trim() || posting}
                  >
                    <Send />
                    {posting ? "Posting…" : "Update"}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div style={{ padding: "32px 0", color: "var(--os-ink-3)", fontSize: 13, textAlign: "center" }}>
            Activity log API coming next. Until then, the Updates tab shows every conversation on this item.
          </div>
        )}
      </div>

      {picker && statusOptions && onStatusPick ? (
        <OsPickerPopover
          anchorRect={picker.rect}
          title="Set status"
          options={statusOptions}
          activeValue={activeStatusValue}
          onSelect={async (v) => {
            const ok = await onStatusPick(v);
            if (ok) {
              bumpRowVersion(moduleId);
              router.refresh();
            }
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}
