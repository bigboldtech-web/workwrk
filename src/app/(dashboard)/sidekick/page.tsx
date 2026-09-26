"use client";

// Ask AI, the full page (spec-ai-automation section 2, /sidekick).
//
// ONE SESSION. The thread is AskAiThread over useAiSession(), the same
// component and the same store the Ask AI panel renders, so a chat started
// in the panel continues here mid-answer ("Open full page"), and the shell
// closes the panel on this route so two threads are never on screen. Cmd+J
// here focuses the composer instead of opening a second one (a page-scoped
// shortcut with its own id, so the global toggle returns on unmount).
//
// The URL states, each honoured (src/lib/ai/url-state.ts):
//
//   /sidekick                      the landing, or the chat this tab already has open
//   /sidekick?new=1                a fresh landing, composer focused
//   /sidekick?session=<id>         that chat
//   /sidekick?q=<text>             a new chat, the text sent at once
//   /sidekick?agent=<slug>         a new chat bound to that agent
//   /sidekick?view=all             All chats; &pinned=1, &archived=1 filter it
//   /sidekick?pinned=1             All chats, pinned (the Favorites target)
//
// A chat is created lazily, on the first send, so "+" never leaves an empty
// "Untitled chat" behind; once it exists the URL names it (?session=), so
// the sidebar row lights and a reload lands on it. The streaming route's
// persistence is untouched by this page: the store reads what it sends.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pin, PinOff, Pencil, Link2, Archive, ArchiveRestore, MessageSquare, Search, Columns3 } from "lucide-react";
import { OsPageHeader, type HeaderMenuEntry } from "@/components/layout/os/page-header";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { TableCard, BulkAction, RowMoreButton, type TableColumn } from "@/components/ui/table-card";
import { ViewTab } from "@/components/ui/view-tabs";
import { Picker } from "@/components/ui/picker";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { AskAiThread } from "@/components/ai/ask-ai-thread";
import { apiFetch } from "@/lib/api-fetch";
import { useShortcut } from "@/lib/shortcuts";
import { ASK_AI_FOCUS_EVENT } from "@/lib/ai/ask-ai-route";
import { notifyAiChatsChanged } from "@/lib/ai/events";
import { aiSession, useAiSession } from "@/lib/ai/session-store";
import { agentChatHref, allChatsHref, sidekickIntent, type AllChatsTab } from "@/lib/ai/url-state";
import { formatDate, formatRelative } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { useSurfaceState } from "@/lib/use-surface-state";
import { pick } from "@/lib/surface-prefs";

export default function AskAiPage() {
  const sp = useSearchParams();
  const intent = sidekickIntent(sp);
  return intent.kind === "all" ? <AllChats tab={intent.tab} /> : <ChatView />;
}

/* ─────────────────────────── the thread ─────────────────────────── */

function ChatView() {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const router = useRouter();
  const sp = useSearchParams();
  const s = useAiSession();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const handledRef = useRef<string | null>(null);
  const firstRunRef = useRef(true);

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  // Cmd+J on this page focuses the composer instead of opening the panel.
  useShortcut({
    id: "sidekick.focus-composer",
    keys: "mod+j",
    label: "Focus the Ask AI composer",
    scope: "page",
    group: "On this page",
    inInputs: true,
    run: (e) => { e.preventDefault(); focusComposer(); },
  });
  useEffect(() => {
    const onFocus = () => focusComposer();
    window.addEventListener(ASK_AI_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(ASK_AI_FOCUS_EVENT, onFocus);
  }, [focusComposer]);

  // The URL states. Each distinct URL is handled once (handledRef), so a
  // re-render never re-sends a ?q= and "+" works on every click.
  useEffect(() => {
    const key = sp?.toString() ?? "";
    if (handledRef.current === key) return;
    handledRef.current = key;
    const first = firstRunRef.current;
    firstRunRef.current = false;
    const intent = sidekickIntent(sp);
    const live = aiSession.getState();
    if (intent.kind === "session") {
      if (live.sessionId !== intent.id) void aiSession.open(intent.id);
      return;
    }
    if (intent.kind === "ask") {
      // The chat's URL (?session=) replaces ?q= once it exists, so a reload
      // never asks the same question twice.
      void aiSession.start({ q: intent.q, agentSlug: intent.agent });
      return;
    }
    if (intent.kind === "new") {
      void aiSession.start({ agentSlug: intent.agent });
      const clean = intent.agent ? agentChatHref(intent.agent) : "/sidekick";
      handledRef.current = clean.split("?")[1] ?? "";
      router.replace(clean, { scroll: false });
      focusComposer();
      return;
    }
    // Bare /sidekick. Arriving here with a chat already open in this tab
    // (from the panel) shows that chat. Coming back to the bare address from
    // a chat on this page (the Ask AI row) is the landing, unless an answer
    // is still arriving, which is never cut off.
    if (first || live.streaming) return;
    aiSession.reset();
  }, [sp, router, focusComposer]);

  // Once the chat exists, the URL names it.
  const intentNow = sidekickIntent(sp);
  const urlSession = intentNow.kind === "session" ? intentNow.id : null;
  useEffect(() => {
    if (!s.sessionId || urlSession === s.sessionId) return;
    if (urlSession && urlSession !== s.sessionId) return; // a different chat is being opened
    const key = `session=${s.sessionId}`;
    handledRef.current = key;
    router.replace(`/sidekick?${key}`, { scroll: false });
  }, [s.sessionId, urlSession, router]);

  async function rename() {
    if (!s.meta) return;
    const title = await prompt({ title: "Rename chat", defaultValue: s.meta.title ?? "", submitLabel: "Save", required: true });
    if (!title || !title.trim()) return;
    const r = await apiFetch(`/api/sidekick/sessions/${s.meta.id}`, { method: "PATCH", json: { title: title.trim().slice(0, 200) } });
    if (!r.ok) { toast("Couldn't rename the chat", { tone: "danger" }); return; }
    s.patchMeta({ title: title.trim() });
    notifyAiChatsChanged();
  }
  async function togglePin() {
    if (!s.meta) return;
    const next = !s.meta.pinned;
    const r = await apiFetch(`/api/sidekick/sessions/${s.meta.id}`, { method: "PATCH", json: { pinned: next } });
    if (!r.ok) { toast("Couldn't update the pin", { tone: "danger" }); return; }
    s.patchMeta({ pinned: next });
    notifyAiChatsChanged();
    toast(next ? "Chat pinned" : "Chat unpinned");
  }
  async function archive() {
    if (!s.meta) return;
    const ok = await confirm({ title: "Archive this chat?", description: "You can restore it from All chats > Archived.", confirmLabel: "Archive", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/sidekick/sessions/${s.meta.id}`, { method: "DELETE" });
    if (!r.ok) { toast("Couldn't archive the chat", { tone: "danger" }); return; }
    notifyAiChatsChanged();
    toast("Chat archived", { action: { label: "See archived", onClick: () => router.push(allChatsHref("archived")) } });
    s.reset();
    handledRef.current = "";
    router.replace("/sidekick");
  }
  async function restore() {
    if (!s.meta) return;
    const r = await apiFetch(`/api/sidekick/sessions/${s.meta.id}`, { method: "PATCH", json: { archived: false } });
    if (!r.ok) { toast("Couldn't restore the chat", { tone: "danger" }); return; }
    s.patchMeta({ archived: false });
    notifyAiChatsChanged();
    toast("Chat restored");
  }
  function copyLink() {
    if (!s.meta) return;
    void navigator.clipboard?.writeText(`${window.location.origin}/sidekick?session=${s.meta.id}`).then(
      () => toast("Link copied"),
      () => toast("Couldn't copy the link", { tone: "danger" }),
    );
  }

  const more: HeaderMenuEntry[] | undefined = s.meta
    ? s.meta.archived
      ? [
          { label: "Restore", icon: ArchiveRestore, onClick: () => void restore() },
          { label: "Copy link", icon: Link2, onClick: copyLink },
        ]
      : [
          { label: "Rename", icon: Pencil, onClick: () => void rename() },
          { label: s.meta.pinned ? "Unpin" : "Pin", icon: s.meta.pinned ? PinOff : Pin, onClick: () => void togglePin() },
          { label: "Copy link", icon: Link2, onClick: copyLink },
          { separator: true },
          { label: "Archive", icon: Archive, destructive: true, onClick: () => void archive() },
        ]
    : undefined;

  const landing = !s.sessionId && s.messages.length === 0 && !s.loading;
  const title = s.meta?.title || (s.agent?.name ?? (landing ? "Ask AI" : "New chat"));

  return (
    // The page fills <main> so the composer sits at the foot of the column
    // and only the thread scrolls. No Ask AI slot: this page is Ask AI.
    <div className="flex h-full min-h-0 flex-col">
      <OsPageHeader title={title} more={more} />
      <AskAiThread width="page" composerRef={composerRef} />
    </div>
  );
}

/* ─────────────────────────── All chats ─────────────────────────── */

type ChatRow = {
  id: string;
  title: string | null;
  pinned: boolean;
  archived: boolean;
  messageCount: number;
  updatedAt: string;
};

const PAGE = 40;
const CHAT_SORTS = ["recent", "title"] as const;
const CHAT_SORT_LABEL: Record<(typeof CHAT_SORTS)[number], string> = { recent: "Last message", title: "Name" };
const OPTIONAL_COLUMNS = ["updated", "messages", "pinned"] as const;
const COLUMN_LABEL: Record<(typeof OPTIONAL_COLUMNS)[number], string> = { updated: "Last message", messages: "Messages", pinned: "Pinned" };

function AllChats({ tab }: { tab: AllChatsTab }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const datePrefs = useDatePrefs();
  const [surface, setSurface] = useSurfaceState("sidekick.allChats");
  const sort = pick(surface.sortKey, CHAT_SORTS, "recent");
  const shown = useMemo(
    () => new Set<string>(surface.columns?.filter((c) => (OPTIONAL_COLUMNS as readonly string[]).includes(c)) ?? OPTIONAL_COLUMNS),
    [surface.columns],
  );
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ChatRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ row: ChatRow; anchor: { current: HTMLElement | null } } | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const load = useCallback(async (at: string | null) => {
    const params = new URLSearchParams({ take: String(PAGE) });
    if (tab === "archived") params.set("archived", "1");
    if (tab === "pinned") params.set("pinned", "1");
    if (sort === "title") params.set("sort", "title");
    if (q.trim()) params.set("q", q.trim());
    if (at) params.set("cursor", at);
    const r = await apiFetch<{ sessions: ChatRow[]; total: number; nextCursor: string | null; restarted?: boolean }>(`/api/sidekick/sessions?${params}`, { cache: "no-store" });
    if (!r.ok) { setError(true); return; }
    setError(false);
    // The page's anchor chat left this list, so the server answered page one.
    if (r.data.restarted) setPages([null]);
    setRows(r.data.sessions);
    setTotal(r.data.total);
    setCursor(r.data.nextCursor);
    setSelected((prev) => (prev.size ? new Set([...prev].filter((id) => r.data.sessions.some((s) => s.id === id))) : prev));
  }, [tab, q, sort]);

  useEffect(() => {
    const t = setTimeout(() => { setPages([null]); void load(null); }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const pageIndex = pages.length - 1;
  const refresh = () => { void load(pages[pageIndex] ?? null); notifyAiChatsChanged(); };

  async function patch(row: ChatRow, body: Record<string, unknown>, done: string) {
    const r = await apiFetch(`/api/sidekick/sessions/${row.id}`, { method: "PATCH", json: body });
    if (!r.ok) { toast("Couldn't update the chat", { tone: "danger", action: { label: "Try again", onClick: () => void patch(row, body, done) } }); return; }
    if (body.title !== undefined && aiSession.getState().sessionId === row.id) aiSession.patchMeta({ title: String(body.title) });
    toast(done);
    refresh();
  }
  async function rename(row: ChatRow) {
    const title = await prompt({ title: "Rename chat", defaultValue: row.title ?? "", submitLabel: "Save", required: true });
    if (title && title.trim()) await patch(row, { title: title.trim().slice(0, 200) }, "Chat renamed");
  }
  async function archiveMany(ids: string[]) {
    const one = ids.length === 1;
    const ok = await confirm({
      title: one ? "Archive this chat?" : `Archive ${ids.length} chats?`,
      description: "You can restore it from All chats > Archived.",
      confirmLabel: "Archive",
      destructive: true,
    });
    if (!ok) return;
    const results = await Promise.all(ids.map((id) => apiFetch(`/api/sidekick/sessions/${id}`, { method: "DELETE" })));
    const failed = results.filter((r) => !r.ok).length;
    if (failed) toast(failed === ids.length ? "Couldn't archive the chats" : `Couldn't archive ${failed} of ${ids.length}`, { tone: "danger" });
    else toast(one ? "Chat archived" : `${ids.length} chats archived`);
    if (ids.includes(aiSession.getState().sessionId ?? "")) aiSession.patchMeta({ archived: true });
    setSelected(new Set());
    refresh();
  }
  async function patchMany(ids: string[], body: Record<string, unknown>, done: string) {
    const results = await Promise.all(ids.map((id) => apiFetch(`/api/sidekick/sessions/${id}`, { method: "PATCH", json: body })));
    const failed = results.filter((r) => !r.ok).length;
    if (failed) toast(`Couldn't update ${failed} of ${ids.length}`, { tone: "danger" });
    else toast(done);
    if (body.archived === false && ids.includes(aiSession.getState().sessionId ?? "")) aiSession.patchMeta({ archived: false });
    setSelected(new Set());
    refresh();
  }

  const columns = useMemo<TableColumn<ChatRow>[]>(() => {
    const cols: TableColumn<ChatRow>[] = [
      { key: "title", label: "Chat", title: true, width: "minmax(240px,1fr)", render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
          <span className="truncate">{r.title || "Untitled chat"}</span>
        </span>
      ) },
    ];
    if (shown.has("updated")) cols.push({ key: "updated", label: "Last message", width: "160px", render: (r) => <span className="text-sm text-ink-2" title={formatDate(r.updatedAt, datePrefs, "datetime")}>{formatRelative(r.updatedAt, datePrefs)}</span> });
    if (shown.has("messages")) cols.push({ key: "messages", label: "Messages", width: "110px", numeric: true, render: (r) => r.messageCount });
    if (shown.has("pinned")) cols.push({ key: "pinned", label: "Pinned", width: "84px", align: "center", render: (r) => (r.pinned ? <Pin className="mx-auto h-4 w-4 text-ink-2" strokeWidth={1.5} aria-label="Pinned" /> : null) });
    return cols;
  }, [datePrefs, shown]);

  const ids = [...selected];
  const selectedRows = (rows ?? []).filter((r) => selected.has(r.id));
  const anyUnpinned = selectedRows.some((r) => !r.pinned);

  return (
    <>
      <OsPageHeader
        title="All chats"
        back={{ fallbackHref: "/sidekick", label: "Ask AI" }}
        views={
          <>
            <ViewTab label="All" active={tab === "all"} href={allChatsHref("all")} />
            <ViewTab label="Pinned" active={tab === "pinned"} href={allChatsHref("pinned")} />
            <ViewTab label="Archived" active={tab === "archived"} href={allChatsHref("archived")} />
          </>
        }
        toolbar={{
          sort: { onClick: () => setSortOpen((o) => !o), label: CHAT_SORT_LABEL[sort], active: true },
          left: (
            <>
              <div className="relative">
                <Picker
                  open={sortOpen}
                  onClose={() => setSortOpen(false)}
                  ariaLabel="Sort chats"
                  width={200}
                  selected={sort}
                  onSelect={(v) => { setSortOpen(false); setSurface({ sortKey: v }); }}
                  sections={[{ options: CHAT_SORTS.map((k) => ({ value: k, label: CHAT_SORT_LABEL[k] })) }]}
                />
              </div>
              <label className="flex h-8 w-56 items-center gap-2 rounded-md border border-line bg-raised px-2.5 text-sm text-ink max-md:w-40">
                <Search className="h-4 w-4 shrink-0 text-ink-2" aria-hidden />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3" />
              </label>
            </>
          ),
          right: (
            <span className="relative">
              <Picker
                open={columnsOpen}
                onClose={() => setColumnsOpen(false)}
                ariaLabel="Columns shown"
                multi
                align="end"
                width={220}
                selected={[...shown]}
                onSelect={(v) => {
                  const next = new Set(shown);
                  if (next.has(v)) next.delete(v); else next.add(v);
                  setSurface({ columns: OPTIONAL_COLUMNS.filter((c) => next.has(c)) });
                }}
                sections={[{ label: "Columns shown", options: OPTIONAL_COLUMNS.map((c) => ({ value: c, label: COLUMN_LABEL[c] })) }]}
              />
            </span>
          ),
          primary: { label: "New chat", onClick: () => router.push("/sidekick?new=1") },
          menu: [{ label: "Columns", icon: Columns3, onClick: () => setColumnsOpen(true) }],
        }}
      />
      <div className="px-6 pb-8 pt-2">
        {error ? (
          <div className="flex h-11 items-center gap-2 text-row text-ink-2">
            Couldn&apos;t load your chats ·
            <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => void load(pages[pageIndex] ?? null)}>Try again</button>
          </div>
        ) : (
          <TableCard
            ariaLabel="Chats"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            rowHref={(r) => `/sidekick?session=${r.id}`}
            selectable
            selected={selected}
            onSelectedChange={setSelected}
            bulkActions={
              tab === "archived" ? (
                <BulkAction icon={ArchiveRestore} label="Restore" onClick={() => void patchMany(ids, { archived: false }, ids.length === 1 ? "Chat restored" : `${ids.length} chats restored`)} />
              ) : (
                <>
                  <BulkAction
                    icon={anyUnpinned ? Pin : PinOff}
                    label={anyUnpinned ? "Pin" : "Unpin"}
                    onClick={() => void patchMany(ids, { pinned: anyUnpinned }, anyUnpinned ? "Pinned" : "Unpinned")}
                  />
                  <BulkAction icon={Archive} label="Archive" destructive onClick={() => void archiveMany(ids)} />
                </>
              )
            }
            rowMenu={(r) => (
              <RowMoreButton
                label={`Actions for ${r.title || "Untitled chat"}`}
                open={menu?.row.id === r.id}
                onClick={(e) => setMenu({ row: r, anchor: { current: e.currentTarget } })}
              />
            )}
            empty={
              q ? (
                <span className="text-row text-ink-2">No results · <button type="button" className="text-brand-deep hover:underline" onClick={() => setQ("")}>Clear search</button></span>
              ) : tab === "archived" ? (
                <span className="text-row text-ink-2">No archived chats</span>
              ) : tab === "pinned" ? (
                <span className="text-row text-ink-2">No pinned chats</span>
              ) : (
                <span className="text-row text-ink-2">No chats yet · <button type="button" className="text-brand-deep hover:underline" onClick={() => router.push("/sidekick?new=1")}>Start a chat</button></span>
              )
            }
            footer={rows && rows.length > 0 ? {
              total,
              noun: "records",
              from: pageIndex * PAGE + 1,
              to: pageIndex * PAGE + rows.length,
              onPrev: pageIndex > 0 ? () => { const next = pages.slice(0, -1); setPages(next); void load(next[next.length - 1] ?? null); } : undefined,
              onNext: cursor ? () => { setPages([...pages, cursor]); void load(cursor); } : undefined,
            } : undefined}
          />
        )}
      </div>
      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label={`Actions for ${menu.row.title || "Untitled chat"}`}>
            {menu.row.archived ? (
              <MenuItem icon={ArchiveRestore} label="Restore" onClick={() => { const r = menu.row; setMenu(null); void patch(r, { archived: false }, "Chat restored"); }} />
            ) : (
              <>
                <MenuItem icon={Pencil} label="Rename" onClick={() => { const r = menu.row; setMenu(null); void rename(r); }} />
                <MenuItem icon={menu.row.pinned ? PinOff : Pin} label={menu.row.pinned ? "Unpin" : "Pin"} onClick={() => { const r = menu.row; setMenu(null); void patch(r, { pinned: !r.pinned }, r.pinned ? "Chat unpinned" : "Chat pinned"); }} />
                <MenuSeparator />
                <MenuItem icon={Archive} label="Archive" destructive onClick={() => { const r = menu.row; setMenu(null); void archiveMany([r.id]); }} />
              </>
            )}
          </MenuList>
        </MorePortal>
      ) : null}
    </>
  );
}
