"use client";

// PublicLinksCard: access toggle 10 (access-model-spec section 8, "Public
// links") as one settings row on the Access page. Off = no new public link
// can be minted for a SOP, a task or a doc and existing links stop answering; View
// only = anyone holding a link reads the object without signing in.
//
// It exists because the share dialogs refuse a new public link while the
// toggle is off and point admins here, so there has to be a control behind
// that sentence. Reads GET /api/settings (settings.access.publicLinks) and
// writes PATCH /api/settings { section: "access", data: { publicLinks } }.
// The row autosaves with the inline "Saved" tick and reverts on failure. A
// failed save says why and offers a Retry that resends the value the admin
// picked (the chassis rule in settings-row.tsx), not a bare "Not saved".
//
// The stored key can also be ABSENT (an org that never saved this page). The
// public docs, tables and forms routes treat absent as "keep what is live"
// (lib/public-links.ts), while a SOP or task link needs an explicit View only, so an
// absent key is shown as its own honest line under the switch instead of a
// flat "Off" that the live links would contradict. Either choice then stores
// an explicit value and every reader agrees.
//
// A SettingsCard with one SettingsRow (settings-cleanup Phase 5, B4 and B5),
// no longer a card of its own with a header strip: "Public links" is the
// card title and its registry anchor (#access.publicLinks), the row says what
// is shared, and the consequence of Off (every existing link stops, which the
// switch does at once, with no confirm) is the row's hint, always visible.

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Dots } from "@/components/ui/dots";
import { apiFetch } from "@/lib/api-fetch";
import { SettingsCard } from "./settings-card";
import { SettingsRow } from "./settings-row";

type PublicLinks = "off" | "view";

// What a failed save leaves behind: the reason to show and the value the
// admin picked. The switch itself reverts to the stored value, so `intended`
// is the only place the choice survives, and it is what Retry resends.
export type PublicLinksFailure = { message: string; intended: PublicLinks };

export function publicLinksFailure(r: { ok: boolean; error?: string }, intended: PublicLinks): PublicLinksFailure | null {
  if (r.ok) return null;
  return { message: r.error?.trim() || "Couldn't save", intended };
}

/** The row's words: what is shared, what Off does (the consequence, never behind Show more), and what it leaves alone. */
export const PUBLIC_LINKS_WORDS = {
  label: "Share SOPs, docs, tasks, tables and forms by public link",
  hint: "Off turns every existing public link off as well.",
  leavesAlone: "A public link works without signing in. Signing links and run links are separate and always work.",
  unset: "Not chosen yet: docs, tables and forms already made public keep working, and new SOP and task links stay off until you choose.",
} as const;

export function PublicLinksCard({ canEdit }: { canEdit: boolean }) {
  const [value, setValue] = useState<PublicLinks | null>(null);
  const [unset, setUnset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [failure, setFailure] = useState<PublicLinksFailure | null>(null);

  useEffect(() => {
    let live = true;
    void apiFetch<{ settings?: { access?: { publicLinks?: PublicLinks } } }>("/api/settings", { cache: "no-store" }).then((r) => {
      if (!live) return;
      const stored = r.ok ? r.data.settings?.access?.publicLinks : undefined;
      setUnset(r.ok && stored !== "view" && stored !== "off");
      setValue(stored === "view" ? "view" : "off");
    });
    return () => { live = false; };
  }, []);

  async function change(on: boolean) {
    const prev = value;
    const next: PublicLinks = on ? "view" : "off";
    setValue(next);
    setFailure(null);
    setSaving(true);
    const r = await apiFetch("/api/settings", { method: "PATCH", json: { section: "access", data: { publicLinks: next } } });
    setSaving(false);
    const failed = publicLinksFailure(r, next);
    if (failed) { setValue(prev); setFailure(failed); return; }
    setUnset(false);
    setSavedAt(Date.now());
  }

  return <PublicLinksCardView canEdit={canEdit} value={value} unset={unset} saving={saving} savedAt={savedAt} failure={failure} onChange={(on) => { void change(on); }} />;
}

/** The card, drawn from its state (exported for the tests). */
export function PublicLinksCardView({
  canEdit,
  value,
  unset,
  saving,
  savedAt,
  failure,
  onChange,
}: {
  canEdit: boolean;
  value: PublicLinks | null;
  unset: boolean;
  saving: boolean;
  savedAt: number | null;
  failure: PublicLinksFailure | null;
  onChange: (on: boolean) => void;
}) {
  const control =
    value === null ? (
      <span className="inline-block h-5 w-9 rounded-full bg-skeleton os-skeleton-pulse" aria-hidden />
    ) : canEdit ? (
      <span className="inline-flex items-center gap-2">
        {saving ? <Dots variant="pending" label="Saving" /> : null}
        <Switch
          checked={value === "view"}
          aria-disabled={saving}
          onChange={onChange}
          aria-labelledby="public-links-label"
          aria-describedby="public-links-hint"
        />
      </span>
    ) : undefined;
  return (
    <SettingsCard title="Public links" id="access.publicLinks">
      <div>
        <SettingsRow
          label={<span id="public-links-label">{PUBLIC_LINKS_WORDS.label}</span>}
          helper={PUBLIC_LINKS_WORDS.hint}
          helperId="public-links-hint"
          control={control}
          // Read-only is the value as text, never a faded control
          // (access-model-spec 5.4).
          readOnlyValue={value !== null && !canEdit ? (value === "view" ? "On" : "Off") : undefined}
          savedAt={savedAt}
          // Retry resends the value the admin picked (the switch shows the stored one meanwhile).
          error={failure ? { message: failure.message, onRetry: () => onChange(failure.intended === "view") } : null}
        >
          <span>{PUBLIC_LINKS_WORDS.leavesAlone}</span>
          {unset ? <span>{PUBLIC_LINKS_WORDS.unset}</span> : null}
        </SettingsRow>
      </div>
    </SettingsCard>
  );
}
