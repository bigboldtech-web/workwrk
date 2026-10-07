"use client";

// A group chat's teammates and what the person can do with the group
// (docs/plans/ai-teammates-phase2.md step 4), opened from the header's
// "N teammates": each teammate with its avatar, name and a Paused or
// Removed chip, and a ghost Remove; then "Add teammate" (the same panel
// turns into the teammates that can join, Back returns), "Rename" and
// "Leave group chat" (asks first: it cancels what still waits in it).
// A group keeps two teammates: Remove at two answers with the server's
// sentence, "Leave it instead".

import { useState } from "react";
import { ArrowLeft, LogOut, PenLine, UserPlus, X } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { StatusChip } from "@/components/ui/chip";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { MenuItem, MenuList, MenuSectionLabel, MenuSeparator } from "@/components/ui/menu";
import { apiFetch } from "@/lib/api-fetch";
import { GROUP_LIMITS } from "@/lib/agents/group-chat";
import { GROUP_COPY, TEAMMATE_CHIPS } from "@/lib/agents/teammate-copy";
import type { GroupDetail, GroupRow } from "@/lib/agents/teammate-thread";
import type { TeammateRow } from "@/lib/agents/teammate-views";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import { TeammateAvatar } from "./teammate-avatar";

export function GroupMembersMenu({
  group: g,
  teammates,
  onChanged,
  onLeft,
  onClose,
  draft = "",
}: {
  group: GroupRow;
  /** The person's teammates (the list's rows), for Add teammate. */
  teammates: readonly TeammateRow[] | null;
  onChanged: (group: GroupDetail) => void;
  onLeft: () => void;
  onClose: () => void;
  /** Words typed in the group's composer: leaving says they will not be kept (review round 1). */
  draft?: string;
}) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const inGroup = new Set(g.members.map((m) => m.slug));
  const addable = (teammates ?? []).filter((t) => t.status === "ENABLED" && !inGroup.has(t.slug));
  const full = g.members.filter((m) => m.status !== "ARCHIVED").length >= GROUP_LIMITS.maxMembers;

  async function patch(body: Record<string, unknown>, again: () => void): Promise<boolean> {
    setBusy(true);
    const r = await apiFetch<{ group: GroupDetail }>(`/api/teammate-groups/${encodeURIComponent(g.id)}`, { method: "PATCH", json: body });
    setBusy(false);
    if (!r.ok) {
      toast(r.code ? r.error : GROUP_COPY.changeFailed, { tone: "danger", ...(r.code ? {} : { action: { label: GROUP_COPY.tryAgain, onClick: again } }) });
      return false;
    }
    onChanged(r.data.group);
    return true;
  }

  async function rename() {
    onClose();
    const next = await prompt({ title: GROUP_COPY.rename, defaultValue: g.name, placeholder: GROUP_COPY.namePlaceholder, submitLabel: GROUP_COPY.rename, cancelLabel: GROUP_COPY.cancel });
    if (next === null) return;
    await patch({ name: next.slice(0, GROUP_LIMITS.nameMax) }, () => void rename());
  }

  async function leave() {
    onClose();
    const ok = await confirm({
      title: GROUP_COPY.leaveTitle(g.name),
      description: draft.trim() ? `${GROUP_COPY.leaveBody} ${GROUP_COPY.leaveUnsent}` : GROUP_COPY.leaveBody,
      confirmLabel: GROUP_COPY.leave,
      destructive: true,
    });
    if (!ok) return;
    const r = await apiFetch(`/api/teammate-groups/${encodeURIComponent(g.id)}`, { method: "DELETE" });
    if (!r.ok) {
      toast(GROUP_COPY.leaveFailed, { tone: "danger", action: { label: GROUP_COPY.tryAgain, onClick: () => void leave() } });
      return;
    }
    toast(GROUP_COPY.leftToast(g.name));
    onLeft();
  }

  if (adding) {
    return (
      <MenuList aria-label={GROUP_COPY.addTeammate} keyboard>
        <MenuItem icon={ArrowLeft} label={GROUP_COPY.back} onClick={() => setAdding(false)} />
        <MenuSeparator />
        {teammates === null ? (
          // Not read yet, or the read failed: never "everyone is already here" (review round 1).
          <p className="m-0 px-3 py-2 text-sm text-ink-2">{GROUP_COPY.teammatesNotLoaded}</p>
        ) : addable.length === 0 ? (
          <p className="m-0 px-3 py-2 text-sm text-ink-2">{GROUP_COPY.nobodyToAdd}</p>
        ) : (
          addable.map((t) => (
            <MenuItem
              key={t.slug}
              leading={<TeammateAvatar name={t.name} hue={t.hue} avatar={t.avatar} size="md" />}
              label={t.name}
              description={t.job}
              disabled={busy}
              onClick={() => {
                const again = () =>
                  void patch({ add: [t.slug] }, again).then((ok) => {
                    if (ok) {
                      setAdding(false);
                      onClose();
                    }
                  });
                again();
              }}
            />
          ))
        )}
      </MenuList>
    );
  }

  return (
    // Reachable by keyboard; each row's Remove is an item of the menu (review round 1).
    <MenuList aria-label={GROUP_COPY.membersButton(g.members.length)} keyboard>
      <MenuSectionLabel>{GROUP_COPY.members}</MenuSectionLabel>
      {g.members.map((m) => (
        <div key={m.agentId} role="presentation" className="flex h-9 min-w-0 items-center gap-2 px-3">
          <TeammateAvatar name={m.name} hue={m.hue} avatar={m.avatar} size="md" />
          <span className="min-w-0 flex-1 truncate text-base text-ink">{m.name}</span>
          {m.status !== "ENABLED" ? (
            <StatusChip color={RUN_TONE_COLOR.neutral} label={m.status === "ARCHIVED" ? TEAMMATE_CHIPS.removed : TEAMMATE_CHIPS.paused} className="shrink-0" />
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              const again = () => void patch({ remove: [m.slug] }, again);
              again();
            }}
            aria-label={`${GROUP_COPY.remove} ${m.name}`}
            title={GROUP_COPY.remove}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60"
          >
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      ))}
      <MenuSeparator />
      <MenuItem icon={UserPlus} label={GROUP_COPY.addTeammate} disabled={busy || full} title={full ? GROUP_COPY.tooMany : undefined} onClick={() => setAdding(true)} />
      <MenuItem icon={PenLine} label={GROUP_COPY.rename} disabled={busy} onClick={() => void rename()} />
      <MenuSeparator />
      <MenuItem icon={LogOut} label={GROUP_COPY.leave} destructive disabled={busy} onClick={() => void leave()} />
    </MenuList>
  );
}
