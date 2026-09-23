"use client";

// Browse channels (spec-talk.md section 3). Two tabs that answer two
// different questions:
//
//   Channels you can join  public, findable, unarchived, not one I am in.
//                          Every Member. This is the tab that makes a
//                          company's channels discoverable at all: before it,
//                          the only way into a channel you were not in was
//                          somebody sending you the link.
//   All channels           Owners and Admins only. EVERY channel, private and
//                          archived included, so an abandoned one can be
//                          archived. Name, member count and the archived flag
//                          and NOTHING ELSE: no topic, no members, no preview.
//                          Access rule 3 says an Owner may not READ a private
//                          channel, and a list that leaked its topic would be
//                          reading it in instalments.
//
// The tab only renders for people the server would answer it for, and the
// server decides again: asking for scope=all without the role returns the
// join list, so a stale tab shows the wrong list rather than the wrong data.
//
// The same rule 3 that withholds a private channel's topic also withholds the
// right to archive it, so the Archive control on this tab is drawn only where
// the viewer actually holds it. See archiveRight() below for who that is and
// what the rows that do not get a button say instead.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Hash, Lock, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dots } from "@/components/ui/dots";
import { SkeletonRows } from "@/components/ui/skeleton";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { WINDOW_EVENTS } from "@/lib/realtime-events";

type BrowseRow = {
  id: string;
  name: string | null;
  topic: string | null;
  restricted: boolean;
  findable: boolean;
  archived: boolean;
  memberCount: number;
  joined: boolean;
  isOwner: boolean;
};

/**
 * May THIS viewer archive or restore THIS row, decided the way the server
 * decides it so the tab stops drawing a button that answers 404.
 *
 * Only an Owner or an Admin ever sees the "All channels" tab, so the org role
 * is a given here and the only questions left are the two the row already
 * answers. talkRole() in src/lib/talk-access.ts:
 *
 *   * Public channel: an Owner or Admin holds Full whether or not they joined,
 *     so Archive and Restore both work. This is the common row.
 *   * Private channel: access rule 3 gives an Owner no read-around at all, so
 *     a non-member resolves to "none" and the PATCH answers "Conversation not
 *     found"; a member who did not create it holds "edit" and the archive
 *     branch answers "You need Full access". Full belongs to the creator while
 *     they are still in it, and to nobody else.
 *   * #general is the company channel and the route refuses to archive it at
 *     all, for anyone.
 *
 * Nothing is taken away by this: the right was never the viewer's to exercise
 * on those rows. What replaces the button is the reason, so the tab says who
 * can archive an abandoned private channel instead of failing at the click.
 */
export function archiveRight(
  row: Pick<BrowseRow, "name" | "restricted" | "joined" | "isOwner">,
): { can: true } | { can: false; label: string; why: string } {
  if ((row.name ?? "").trim().toLowerCase() === "general") {
    return {
      can: false,
      label: "Company channel",
      why: "#general is the company channel. It can't be archived.",
    };
  }
  if (row.restricted && !(row.isOwner && row.joined)) {
    return {
      can: false,
      label: "Creator only",
      why: "A private channel can only be archived by the person who created it, from inside the channel. An Owner can see that it exists and how many people are in it, and nothing else.",
    };
  }
  return { can: true };
}

export function BrowseChannelsDialog({
  open,
  onClose,
  onCreateChannel,
}: {
  open: boolean;
  onClose: () => void;
  onCreateChannel: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [scope, setScope] = useState<"join" | "all">("join");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<BrowseRow[] | null>(null);
  const [canSeeAll, setCanSeeAll] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const params = new URLSearchParams({ scope });
    if (q.trim()) params.set("q", q.trim());
    const r = await apiFetch<{ channels?: BrowseRow[]; canSeeAll?: boolean; scope?: string }>(
      `/api/conversations/browse?${params.toString()}`,
      { cache: "no-store" },
    );
    if (!r.ok) { setFailed(true); return; }
    setRows(r.data?.channels ?? []);
    setCanSeeAll(Boolean(r.data?.canSeeAll));
  }, [scope, q]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void load(), q ? 220 : 0);
    return () => clearTimeout(t);
  }, [open, load, q]);

  const join = async (row: BrowseRow) => {
    setBusyId(row.id);
    const r = await apiFetch(`/api/conversations/${row.id}/join`, { method: "POST" });
    setBusyId(null);
    if (!r.ok) { toast(r.error || "Couldn't join that channel", { tone: "danger" }); return; }
    window.dispatchEvent(new Event(WINDOW_EVENTS.chatChanged));
    onClose();
    router.push(`/tlk/${row.id}`);
  };

  const setArchived = async (row: BrowseRow, archived: boolean) => {
    setBusyId(row.id);
    const r = await apiFetch(`/api/conversations/${row.id}`, { method: "PATCH", json: { archived } });
    setBusyId(null);
    if (!r.ok) { toast(r.error || "Couldn't change that channel", { tone: "danger" }); return; }
    setRows((prev) => (prev ?? []).map((x) => (x.id === row.id ? { ...x, archived } : x)));
    window.dispatchEvent(new Event(WINDOW_EVENTS.chatChanged));
    toast(archived ? "Channel archived. Its history stays." : "Channel restored");
  };

  const tab = (active: boolean) =>
    `h-8 rounded-md px-2.5 text-sm ${active ? "bg-selected font-medium text-ink-strong" : "text-ink-2 hover:bg-hover"}`;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-full" style={{ maxWidth: 560 }}>
        <DialogHeader>
          <DialogTitle>Browse channels</DialogTitle>
        </DialogHeader>

        <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-app px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search channels"
            aria-label="Search channels"
            className="h-full w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          />
        </div>

        {canSeeAll ? (
          <div className="mt-2 flex items-center gap-1">
            <button type="button" onClick={() => { setScope("join"); setRows(null); }} className={tab(scope === "join")}>
              Channels you can join
            </button>
            <button type="button" onClick={() => { setScope("all"); setRows(null); }} className={tab(scope === "all")}>
              All channels
            </button>
          </div>
        ) : null}

        <div className="mt-2 max-h-[320px] min-h-[160px] overflow-y-auto">
          {failed ? (
            <OsEmptyView
              title="Couldn't load channels"
              variant="error"
              compact
              action={{ label: "Retry", onClick: () => void load() }}
            />
          ) : rows === null ? (
            <SkeletonRows rows={4} rowHeight="44px" />
          ) : rows.length === 0 ? (
            <p className="m-0 px-1 py-8 text-center text-sm text-ink-2">
              {scope === "join" ? "There are no other channels to join." : "No channels matched."}
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {rows.map((row) => {
                const right = archiveRight(row);
                return (
                  <li key={row.id} className="flex min-h-11 items-center gap-2 border-b border-line-soft px-1 py-2 last:border-b-0">
                    {row.restricted
                      ? <Lock className="h-4 w-4 shrink-0 text-ink-3" aria-label="Private channel" />
                      : <Hash className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-ink">{row.name ?? "channel"}</span>
                        {row.archived ? (
                          <span className="shrink-0 rounded-full bg-hover px-1.5 text-micro font-medium text-ink-2">Archived</span>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-ink-2">
                        {row.memberCount === 1 ? "1 member" : `${row.memberCount} members`}
                        {row.topic ? ` · ${row.topic}` : ""}
                      </span>
                    </span>
                    {scope === "join" ? (
                      <button
                        type="button"
                        onClick={() => void join(row)}
                        disabled={busyId === row.id}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50"
                      >
                        {busyId === row.id ? <Dots variant="pending" label="Joining" /> : null} Join
                      </button>
                    ) : right.can ? (
                      <button
                        type="button"
                        onClick={() => void setArchived(row, !row.archived)}
                        disabled={busyId === row.id}
                        title={row.archived ? "Restore channel" : "Archive channel"}
                        aria-label={row.archived ? "Restore channel" : "Archive channel"}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
                      >
                        {row.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                      </button>
                    ) : (
                      <span className="shrink-0 text-xs text-ink-3" title={right.why}>
                        {right.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="m-0 mt-2 text-xs text-ink-2">
          Not there?{" "}
          <button type="button" onClick={() => { onClose(); onCreateChannel(); }} className="font-medium text-[var(--os-brand-deep)] underline underline-offset-2 hover:no-underline">
            Create channel
          </button>
        </p>
      </DialogContent>
    </Dialog>
  );
}
