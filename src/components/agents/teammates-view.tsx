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
// there for this person says so, with any words they could not send to it
// under the sentence (teammate-chat.tsx UnsentDraft).

import { useEffect, useState, type ReactNode } from "react";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { DotsArt } from "@/components/ui/dots-art";
import { SkeletonLines } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { GROUP_COPY, TEAMMATE_CHAT, TEAMMATE_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { groupChatKey, useTeammateDraft, type TeammateListData } from "@/lib/agents/teammate-store";
import { startersFor, type GroupDetail, type GroupRow, type TeammateSettingsTab } from "@/lib/agents/teammate-thread";
import type { TeammateRow } from "@/lib/agents/teammate-views";
import { cn } from "@/lib/utils";
import { GroupChat } from "./group-chat";
import { TeammateChat, UnsentDraft } from "./teammate-chat";
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
  selectedGroupId = null,
  actionId,
  onSelect,
  onSelectGroup,
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
  /** ?group=<id> (Phase 2): a group chat, which wins over ?chat. */
  selectedGroupId?: string | null;
  onSelectGroup: (id: string) => void;
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

  // A send that found the teammate gone (404) puts the words back in the
  // composer, and then the chat goes: they stay on screen here instead.
  const unsent = useTeammateDraft(selectedSlug);
  const unsentInGroup = useTeammateDraft(selectedGroupId ? groupChatKey(selectedGroupId) : null);

  // The group named in the address, read on its own when the list does not hold it.
  const groups = list?.groups ?? [];
  const listedGroup = selectedGroupId ? (groups.find((g) => g.id === selectedGroupId) ?? null) : null;
  const [ownGroup, setOwnGroup] = useState<{ id: string; row: GroupRow | null } | null>(null);
  const needOwnGroup = Boolean(selectedGroupId) && !listedGroup && (rows !== null || listError);
  useEffect(() => {
    if (!needOwnGroup || !selectedGroupId) return;
    let alive = true;
    void apiFetch<{ group: GroupDetail }>(`/api/teammate-groups/${encodeURIComponent(selectedGroupId)}`, { cache: "no-store" }).then((r) => {
      if (!alive) return;
      if (!r.ok && r.status !== 404) return;
      setOwnGroup({ id: selectedGroupId, row: r.ok ? r.data.group : null });
    });
    return () => {
      alive = false;
    };
  }, [needOwnGroup, selectedGroupId, rows]);
  const group: GroupRow | null | undefined = !selectedGroupId ? null : listedGroup ?? (ownGroup && ownGroup.id === selectedGroupId ? ownGroup.row : undefined);

  let pane: ReactNode;
  if (selectedGroupId) {
    if (group === undefined) {
      pane = (
        <div className="mx-auto w-[min(720px,100%-32px)] py-6">
          <SkeletonLines lines={3} />
        </div>
      );
    } else if (group === null) {
      pane = (
        <OsEmptyView title={GROUP_COPY.notFound} action={{ label: TEAMMATE_CHAT.back, onClick: onBack }}>
          {unsentInGroup.trim() ? <UnsentDraft text={unsentInGroup} className="w-full text-start" /> : null}
        </OsEmptyView>
      );
    } else {
      pane = (
        <GroupChat
          key={group.id}
          group={group}
          teammates={rows}
          teammatesFailed={listError && rows === null}
          onReloadTeammates={onReload}
          actionId={actionId}
          onBack={onBack}
          onChanged={() => onReload()}
          onLeft={() => {
            onReload();
            onBack();
          }}
          onOpenSettings={onOpenSettings}
        />
      );
    }
  } else if (!selectedSlug) {
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
    pane = (
      <OsEmptyView title={TEAMMATE_ROUTE_ERRORS.teammateNotFound} action={{ label: TEAMMATE_CHAT.back, onClick: onBack }}>
        {unsent.trim() ? <UnsentDraft text={unsent} className="w-full text-start" /> : null}
      </OsEmptyView>
    );
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
        groups={groups}
        selectedGroupId={selectedGroupId}
        onSelectGroup={onSelectGroup}
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
        className={cn("w-full lg:w-[320px] lg:shrink-0 lg:border-e", (selectedSlug || selectedGroupId) && "max-lg:hidden")}
      />
      <div className={cn("flex min-w-0 flex-1 flex-col", !selectedSlug && !selectedGroupId && "max-lg:hidden")}>{pane}</div>
    </div>
  );
}
