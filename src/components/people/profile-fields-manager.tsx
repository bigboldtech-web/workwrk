"use client";

// Profile fields (decided addition c): the org's custom fields on every
// person's record, defined here (Settings > Structure > Profile fields) by
// Owners, Admins and the People team. Each field is a name; its values are
// filled from a person's Edit details by whoever may edit that record's
// placement, and read on the record by everyone who reads its people data.
//
// Every change saves as it is made (the whole list, PUT, through the record
// write queue, so a dropped connection retries). Removing a field never
// deletes anyone's value: the record just stops showing it, and defining a
// field with the same name again brings the values back.
//
// Drawn as one SettingsCard at the page's width (settings-cleanup Phase 4):
// what the fields are as its description, the save state at the right of its
// title, one SettingsRow per field, the inline "No profile fields yet" line
// (B10) when there are none, and the New field name field, which keeps its
// own 560px, with Add field: the tab's one blue button, grey while there is
// nothing to add (B8), never a pale blue.

import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { recordWriteQueue } from "@/lib/people/record-write-queue";
import { keyForLabel, MAX_PROFILE_FIELDS, type ProfileFieldDef } from "@/lib/people/profile-fields";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/dialog-provider";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { btn } from "@/components/settings/settings-form";
import { cn } from "@/lib/utils";

export type SaveState = "idle" | "saving" | "saved" | "retrying" | { error: string };

/** What the fields are: the card's description, the words the tab always said. */
export const PROFILE_FIELDS_INTRO =
  "Extra fields on every person’s record, like Employee ID or Pronouns. Whoever can edit a person’s job title and department fills them in from Edit details; everyone who can see that person’s people data reads them.";

/** The blue Add field, grey while disabled (B8: --os-surface-2 with --os-ink-4), as the toolbar's primary is. */
export const PRIMARY_GREY_DISABLED = cn(btn.primary, "h-9 shrink-0 disabled:bg-active disabled:text-ink-4 disabled:opacity-100");

export function ProfileFieldsManager() {
  const confirm = useConfirm();
  const [fields, setFields] = useState<ProfileFieldDef[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [save, setSave] = useState<SaveState>("idle");
  const newRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void apiFetch<{ fields: ProfileFieldDef[]; canEdit: boolean }>("/api/people/profile-fields", { cache: "no-store" }).then((r) => {
      if (!live) return;
      if (!r.ok) { setLoadError(r.error || "Couldn't load the profile fields"); return; }
      setFields(r.data.fields);
      setCanEdit(r.data.canEdit);
    });
    return () => { live = false; };
  }, []);

  async function persist(next: ProfileFieldDef[], prev: ProfileFieldDef[]) {
    setFields(next);
    setSave("saving");
    const r = await recordWriteQueue().write("PUT", "/api/people/profile-fields", { fields: next }, {
      onRetrying: () => setSave("retrying"),
    });
    if (!r.ok) { setFields(prev); setSave({ error: r.error || "Not saved" }); return; }
    setSave("saved");
  }

  function add() {
    if (!fields) return;
    const label = draft.trim();
    if (!label) return;
    if (fields.some((f) => f.label.toLowerCase() === label.toLowerCase())) { setSave({ error: `There is already a field named ${label}` }); return; }
    setDraft("");
    void persist([...fields, { key: keyForLabel(label, fields.map((f) => f.key)), label }], fields);
  }
  function rename(i: number, label: string) {
    if (!fields) return;
    const clean = label.trim();
    if (!clean || clean === fields[i].label) return;
    void persist(fields.map((f, j) => (j === i ? { ...f, label: clean } : f)), fields);
  }
  function move(i: number, by: -1 | 1) {
    if (!fields) return;
    const j = i + by;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    void persist(next, fields);
  }
  async function remove(i: number) {
    if (!fields) return;
    const ok = await confirm({
      title: `Remove ${fields[i].label}?`,
      description: "It stops showing on every record. Values already filled in are kept, and come back if you add a field with the same name again.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    void persist(fields.filter((_, j) => j !== i), fields);
  }

  if (loadError) return <OsEmptyView variant="error" title="Couldn't load the profile fields" hint={loadError} compact />;
  if (!fields) return <SkeletonRows rows={3} rowHeight="44px" />;

  return (
    <ProfileFieldsCard
      fields={fields}
      canEdit={canEdit}
      save={save}
      draft={draft}
      onDraft={setDraft}
      onAdd={add}
      onRename={rename}
      onMove={move}
      onRemove={(i) => { void remove(i); }}
      newRef={newRef}
    />
  );
}

/** The card itself, from the manager's state (exported for its render test). */
export function ProfileFieldsCard({
  fields,
  canEdit,
  save,
  draft,
  onDraft,
  onAdd,
  onRename,
  onMove,
  onRemove,
  newRef,
}: {
  fields: ProfileFieldDef[];
  canEdit: boolean;
  save: SaveState;
  draft: string;
  onDraft: (v: string) => void;
  onAdd: () => void;
  onRename: (i: number, label: string) => void;
  onMove: (i: number, by: -1 | 1) => void;
  onRemove: (i: number) => void;
  newRef?: RefObject<HTMLInputElement | null>;
}) {
  const canAdd = canEdit && fields.length < MAX_PROFILE_FIELDS;
  return (
    <SettingsCard
      title="Profile fields"
      description={PROFILE_FIELDS_INTRO}
      actions={
        // Always in the page, so a screen reader hears each change of state;
        // no height of its own, so on a phone, where it sits under the
        // title, an idle card has no empty band.
        <span className="inline-flex items-center text-sm" aria-live="polite">
          {save === "saving" ? <span className="text-ink-2">Saving</span> : null}
          {save === "saved" ? <span className="text-ink-2">Saved</span> : null}
          {save === "retrying" ? <span className="text-danger-text">Not saved, retrying</span> : null}
          {typeof save === "object" ? <span role="alert" className="text-danger-text">{save.error}</span> : null}
        </span>
      }
    >
      {fields.length === 0 ? (
        <p className="m-0 text-base text-ink-2">
          No profile fields yet
          {canAdd ? (
            <>
              {" · "}
              <button type="button" className="text-brand-deep hover:underline" onClick={() => newRef?.current?.focus()}>Add one</button>
            </>
          ) : null}
        </p>
      ) : (
        <div>
          {fields.map((f, i) => (
            <SettingsRow
              key={`${f.key}:${f.label}`}
              label={
                canEdit ? (
                  // The name is edited in place; pulled back by its own padding so it starts on the row's edge.
                  <input
                    defaultValue={f.label}
                    aria-label={`Field name ${i + 1}`}
                    maxLength={60}
                    onBlur={(e) => onRename(i, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    className="-ms-2 h-9 w-full max-w-[560px] rounded-md border border-transparent bg-transparent px-2 text-base font-medium text-ink hover:border-line focus:border-brand focus:outline-none"
                  />
                ) : (
                  f.label
                )
              }
              control={
                canEdit ? (
                  <span className="inline-flex items-center gap-1">
                    <button type="button" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => onMove(i, -1)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"><ArrowUp className="h-4 w-4" aria-hidden /></button>
                    <button type="button" aria-label={`Move ${f.label} down`} disabled={i === fields.length - 1} onClick={() => onMove(i, 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"><ArrowDown className="h-4 w-4" aria-hidden /></button>
                    <button type="button" aria-label={`Remove ${f.label}`} onClick={() => onRemove(i)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-danger-text"><X className="h-4 w-4" aria-hidden /></button>
                  </span>
                ) : undefined
              }
            />
          ))}
        </div>
      )}
      {canAdd ? (
        <div className="flex w-full max-w-[560px] items-center gap-2">
          <input
            ref={newRef}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
            placeholder="New field name"
            aria-label="New field name"
            maxLength={60}
            className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
          />
          <button type="button" disabled={!draft.trim()} onClick={onAdd} className={PRIMARY_GREY_DISABLED}>
            <Plus className="h-4 w-4" aria-hidden /> Add field
          </button>
        </div>
      ) : null}
      {canEdit && fields.length >= MAX_PROFILE_FIELDS ? <p className="m-0 text-sm text-ink-2">Up to {MAX_PROFILE_FIELDS} profile fields.</p> : null}
    </SettingsCard>
  );
}
