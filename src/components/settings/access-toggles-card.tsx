"use client";

// The ten access switches on Workspace settings > Access (access-model-spec
// 6.5 and 8; Phase 8 stage E). Only a switch the product reads today is a
// live control in the card (toggle-status.ts decides, from the flag state
// GET /api/settings/access-model reports); every other switch sits behind
// Show upcoming features with the caption that says why it is not enforced
// yet, so nothing on the page is decorative. Each row autosaves through the
// strict PATCH /api/settings { section: "access" } with the inline tick,
// reverts and offers Retry on a failure, and carries its "Enforced at"
// tooltip. Public links keep their own card (PublicLinksCard).
//
// Lock it down (spec 7.4) applies the preset WITHOUT the People team keys,
// after a confirm that lists what changes.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { SkeletonRows } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";
import { useConfirm } from "@/components/ui/dialog-provider";
import { apiFetch } from "@/lib/api-fetch";
import { liveToggleKeys, lockItDownChanges, lockItDownPatch, type ToggleKey, type ToggleStatus } from "@/lib/access/toggle-status";
import type { AccessSettings } from "@/lib/access/types";

interface AccessModel {
  flags: { resolver: boolean; tables: boolean; logOnly: boolean; ownerSplit: boolean };
  canEdit: boolean;
  toggles: AccessSettings;
  statuses: ToggleStatus[];
  matrixDecides: boolean;
  matrixStored?: boolean;
  matrixRetiredAt?: string | null;
  mayExportMatrix?: boolean;
}

// `intended` is the value the person picked when a save failed, so Retry
// sends THAT value again (the row shows the stored value meanwhile).
type RowState = { savedAt?: number; error?: string | null; intended?: unknown };

const OPTIONS: Partial<Record<ToggleKey, { value: string; label: string }[]>> = {
  whoCanCreateSpaces: [
    { value: "everyone", label: "Everyone" },
    { value: "admins", label: "Owners and Admins" },
  ],
  newSpaceDefault: [
    { value: "everyone_edit", label: "Everyone can edit" },
    { value: "everyone_view", label: "Everyone can view" },
    { value: "private", label: "Private" },
  ],
  whoCanInviteGuests: [
    { value: "full_access", label: "Full access" },
    { value: "admins", label: "Admins" },
    { value: "nobody", label: "Nobody" },
  ],
  whoCanPublish: [
    { value: "editors", label: "Editors" },
    { value: "admins_people_team", label: "Admins and People team" },
  ],
  whoCanDelete: [
    { value: "full_access", label: "Full access" },
    { value: "admins", label: "Admins" },
  ],
  guestExpiryDays: [
    { value: "0", label: "Never" },
    { value: "30", label: "30 days" },
    { value: "90", label: "90 days" },
  ],
};

const WORD: Record<string, string> = Object.fromEntries(
  Object.values(OPTIONS).flatMap((opts) => (opts ?? []).map((o) => [o.value, o.label])),
);

export function AccessTogglesCard({ onModel }: { onModel?: (m: AccessModel) => void }) {
  const [model, setModel] = useState<AccessModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Partial<Record<ToggleKey, RowState>>>({});
  const [lockError, setLockError] = useState<{ message: string; keys: ToggleKey[] } | null>(null);
  const [locking, setLocking] = useState(false);
  const showUpcoming = useShowUpcoming();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setError(null);
    const r = await apiFetch<AccessModel>("/api/settings/access-model", { cache: "no-store" });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setModel(r.data);
    onModel?.(r.data);
  }, [onModel]);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const save = async (key: ToggleKey, value: unknown) => {
    if (!model) return;
    // Roll back THIS key alone on a failure: a second switch saved meanwhile
    // keeps its own value.
    const before = model.toggles[key];
    setModel((m) => (m ? { ...m, toggles: { ...m.toggles, [key]: value } as AccessSettings } : m));
    setRows((r) => ({ ...r, [key]: { error: null } }));
    const res = await apiFetch("/api/settings", { method: "PATCH", json: { section: "access", data: { [key]: value } } });
    if (!res.ok) {
      setModel((m) => (m ? { ...m, toggles: { ...m.toggles, [key]: before } as AccessSettings } : m));
      setRows((r) => ({ ...r, [key]: { error: res.error || "Couldn't save", intended: value } }));
      return;
    }
    setRows((r) => ({ ...r, [key]: { savedAt: Date.now(), error: null } }));
  };

  const lockItDown = async () => {
    if (!model) return;
    setLockError(null);
    const liveKeys = liveToggleKeys(model.statuses);
    const changes = lockItDownChanges(model.toggles, liveKeys);
    if (changes.length === 0) return;
    const labels = changes.map((k) => model.statuses.find((s) => s.key === k)?.label ?? k).join(", ");
    const ok = await confirm({
      title: "Lock it down?",
      description: `This changes: ${labels}. The People team stays as it is. You can change any switch back afterwards.`,
      confirmLabel: "Lock it down",
      destructive: false,
    });
    if (!ok) return;
    await applyLock(liveKeys);
  };

  const applyLock = async (liveKeys: ToggleKey[]) => {
    setLocking(true);
    const res = await apiFetch("/api/settings", { method: "PATCH", json: { section: "access", data: lockItDownPatch(liveKeys) } });
    setLocking(false);
    if (res.ok) {
      setLockError(null);
      await load();
    } else {
      // Nothing changed on the server (one PATCH, one statement): say so, and
      // offer the same change again.
      setLockError({ message: res.error || "Couldn't lock it down", keys: liveKeys });
    }
  };

  if (error && !model) {
    return (
      <SettingsCard title="Access switches" id="access.toggles" wide="access.toggles">
        <ErrorState what="the access switches" hint={error} onRetry={() => { void load(); }} />
      </SettingsCard>
    );
  }
  if (!model) {
    return (
      <SettingsCard title="Access switches" id="access.toggles" wide="access.toggles">
        <SkeletonRows rows={4} />
      </SettingsCard>
    );
  }

  const control = (s: ToggleStatus) => {
    const v = model.toggles[s.key];
    if (s.key === "peopleTeamUserIds") {
      const who = model.toggles.peopleTeamUserIds.length > 0
        ? `${model.toggles.peopleTeamUserIds.length} ${model.toggles.peopleTeamUserIds.length === 1 ? "person" : "people"}`
        : "Everyone at the HR level";
      if (!model.canEdit) return <span className="text-base text-ink">{who}</span>;
      return (
        <span className="inline-flex items-center gap-3 text-base">
          <span className="text-ink">{who}</span>
          <Link href="/settings/members?tab=people&filter=peopleteam" className="font-medium text-brand-deep hover:underline">Change on Members</Link>
        </span>
      );
    }
    if (s.key === "findableSpaces" || s.key === "editorsCanShare") {
      return model.canEdit ? (
        <Switch checked={v === true} onChange={(on: boolean) => { void save(s.key, on); }} aria-label={s.label} />
      ) : undefined;
    }
    const opts = OPTIONS[s.key];
    if (!opts || !model.canEdit) return undefined;
    return (
      <SegmentedControl
        size="sm"
        label={s.label}
        value={String(v)}
        options={opts}
        onChange={(next) => { void save(s.key, s.key === "guestExpiryDays" ? Number(next) : next); }}
      />
    );
  };

  const readOnly = (s: ToggleStatus) => {
    if (model.canEdit || s.key === "peopleTeamUserIds") return undefined;
    const v = model.toggles[s.key];
    if (typeof v === "boolean") return v ? "On" : "Off";
    return WORD[String(v)] ?? String(v);
  };

  const row = (s: ToggleStatus) => (
    <SettingsRow
      key={s.key}
      id={`access.${s.key}`}
      label={s.label}
      helper={s.caption ? `${s.effect} ${s.caption}` : s.effect}
      control={control(s)}
      readOnlyValue={readOnly(s)}
      enforcedAt={s.enforcedAt}
      savedAt={rows[s.key]?.savedAt ?? null}
      error={rows[s.key]?.error ? { message: rows[s.key]?.error ?? undefined, onRetry: () => { const st = rows[s.key]; void save(s.key, st && "intended" in st ? st.intended : model.toggles[s.key]); } } : null}
    />
  );

  const live = model.statuses.filter((s) => s.live && s.key !== "publicLinks");
  const later = model.statuses.filter((s) => !s.live);
  const lockButton = model.canEdit ? (
    <button
      type="button"
      onClick={() => { void lockItDown(); }}
      disabled={locking || lockItDownChanges(model.toggles, liveToggleKeys(model.statuses)).length === 0}
      className="os-chrome inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover disabled:cursor-default disabled:text-ink-3"
    >
      <ShieldCheck className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      Lock it down
    </button>
  ) : null;

  return (
    <SettingsCard
      title="Access switches"
      id="access.toggles"
      wide="access.toggles"
      description={
        later.length === 0
          ? "Who creates, shares, publishes and invites. Every switch here is enforced."
          : "The switches the product reads today. The rest arrive with the new access engine, under Show upcoming features."
      }
      actions={model.flags.resolver ? lockButton : undefined}
    >
      {lockError ? (
        <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-text">
          <span>{lockError.message}. Nothing was changed.</span>
          <button
            type="button"
            onClick={() => { void applyLock(lockError.keys); }}
            disabled={locking}
            className="font-medium underline-offset-2 hover:underline disabled:opacity-60"
          >
            Retry
          </button>
        </div>
      ) : null}
      <div className="flex flex-col">{live.map(row)}</div>
      {showUpcoming && later.length > 0 ? (
        <div className="mt-4 flex flex-col">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="text-micro font-semibold uppercase tracking-[0.06em] text-ink-2">Not enforced yet</span>
            {model.flags.resolver ? null : lockButton}
          </div>
          {later.map(row)}
        </div>
      ) : null}
    </SettingsCard>
  );
}
