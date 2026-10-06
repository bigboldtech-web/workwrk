"use client";

// Chats and Waiting for you (docs/plans/ai-teammates.md 5.1, 5.2): the list
// of teammates at the left, the chat with the one picked at the right. Under
// 1024px the two stack: the list fills the width, and picking a teammate
// replaces it with the chat, whose Back returns to the list.
//
// The list is the hub's (useTeammateList, read again on focus and on the
// realtime agent.changed); the chat reads itself (teammate-chat.tsx). A chat
// named in the address that the list does not hold (a removed teammate while
// Show removed is off, a link from the Inbox) is read on its own
// (GET /api/agents/teammates/[slug]), so it still opens; one that is not
// there for this person says so.

import { useEffect, useState, type ReactNode } from "react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { DotsArt } from "@/components/ui/dots-art";
import { SkeletonLines } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { TEAMMATE_CHAT, TEAMMATE_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import type { TeammateListData } from "@/lib/agents/teammate-store";
import { startersFor, type TeammateSettingsTab } from "@/lib/agents/teammate-thread";
import type { TeammateRow } from "@/lib/agents/teammate-views";
import { cn } from "@/lib/utils";
import { TeammateChat } from "./teammate-chat";
import { TeammateList } from "./teammate-list";

export function TeammatesView({
  list,
  listError,
  onReload,
  waitingOnly,
  query,
  onClearQuery,
  showRemoved,
  onShowRemoved,
  selectedSlug,
  actionId,
  onSelect,
  onBack,
  onNewTeammate,
  onOpenSettings,
}: {
  list: TeammateListData | null;
  listError: boolean;
  onReload: () => void;
  /** Waiting for you: only the teammates with something waiting. */
  waitingOnly: boolean;
  query: string;
  onClearQuery: () => void;
  showRemoved: boolean;
  onShowRemoved: (on: boolean) => void;
  /** ?chat=<slug> */
  selectedSlug: string | null;
  /** &action=<id> */
  actionId: string | null;
  onSelect: (slug: string) => void;
  onBack: () => void;
  onNewTeammate: () => void;
  onOpenSettings: (tab?: TeammateSettingsTab) => void;
}) {
  const rows = list?.teammates ?? null;
  const listed = selectedSlug && rows ? (rows.find((r) => r.slug === selectedSlug) ?? null) : null;

  // The chat named in the address, read on its own when the list does not
  // hold it. Read again whenever the list is, so its state stays current.
  const [own, setOwn] = useState<{ slug: string; row: TeammateRow | null } | null>(null);
  const needOwn = Boolean(selectedSlug) && !listed && (rows !== null || listError);
  useEffect(() => {
    if (!needOwn || !selectedSlug) return;
    let alive = true;
    void apiFetch<{ teammate: TeammateRow }>(`/api/agents/teammates/${encodeURIComponent(selectedSlug)}`, { cache: "no-store" }).then((r) => {
      if (!alive) return;
      // A failed read that is not a 404 keeps what was shown.
      if (!r.ok && r.status !== 404) return;
      setOwn({ slug: selectedSlug, row: r.ok ? r.data.teammate : null });
    });
    return () => {
      alive = false;
    };
  }, [needOwn, selectedSlug, rows]);

  // undefined: still reading; null: not there for this person.
  const selected: TeammateRow | null | undefined = !selectedSlug ? null : listed ?? (own && own.slug === selectedSlug ? own.row : undefined);

  let pane: ReactNode;
  if (!selectedSlug) {
    pane = (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <DotsArt arrangement="row" className="mb-4" />
        <p className="text-row text-ink-2">{TEAMMATE_CHAT.pick}</p>
      </div>
    );
  } else if (selected === undefined) {
    pane = (
      <div className="mx-auto w-[min(720px,100%-32px)] py-6">
        <SkeletonLines lines={3} />
      </div>
    );
  } else if (selected === null) {
    pane = <OsEmptyView title={TEAMMATE_ROUTE_ERRORS.teammateNotFound} action={{ label: TEAMMATE_CHAT.back, onClick: onBack }} />;
  } else {
    pane = (
      <TeammateChat
        key={selected.slug}
        teammate={selected}
        starters={startersFor(list?.templates, selected.template)}
        actionId={actionId}
        onBack={onBack}
        onOpenSettings={onOpenSettings}
        onChanged={onReload}
      />
    );
  }

  return (
    <div className="os-chrome flex min-h-0 flex-1">
      <TeammateList
        rows={rows}
        error={listError}
        onRetry={onReload}
        query={query}
        onClearQuery={onClearQuery}
        waitingOnly={waitingOnly}
        showRemoved={showRemoved}
        onShowRemoved={onShowRemoved}
        selectedSlug={selectedSlug}
        onSelect={onSelect}
        onNewTeammate={onNewTeammate}
        className={cn("w-full lg:w-[320px] lg:shrink-0 lg:border-e", selectedSlug && "max-lg:hidden")}
      />
      <div className={cn("flex min-w-0 flex-1 flex-col", !selectedSlug && "max-lg:hidden")}>{pane}</div>
    </div>
  );
}
