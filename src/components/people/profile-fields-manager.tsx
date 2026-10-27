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
// field with the same name again brings the values back. A change refused
// is put right by reading the list again once no change is still out (final
// Settings review, L3): putting back the list from before it threw away a
// later change that had saved.
//
// Drawn as one SettingsCard at the page's width (settings-cleanup Phase 4):
// what the fields are as its description, the save state at the right of its
// title, one SettingsRow per field, and the inline "No profile fields yet"
// line (B10) when there are none.
//
// ONE FORM OF CREATE (final Settings review, M3): "New field" is the tab's
// toolbar primary, drawn by this manager into the page header's toolbar row
// (SettingsToolbar; the Structure tab says ownToolbar), because who may add
// a field is the read's answer (Owners, Admins and the People team) and the
// button greys at the limit (B8). It opens the name row under the fields:
// the field at its own 560px, Add field (secondary: the toolbar's is the one
// blue) and Cancel. The empty line's "Add one" opens the same row.

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
import { SettingsToolbar } from "@/components/settings/settings-page";
import { btn } from "@/components/settings/settings-form";
import { cn } from "@/lib/utils";

export type SaveState = "idle" | "saving" | "saved" | "retrying" | { error: string };

/** What the fields are: the card's description, the words the tab always said. */
export const PROFILE_FIELDS_INTRO =
  "Extra fields on every person’s record, like Employee ID or Pronouns. Whoever can edit a person’s job title and department fills them in from Edit details; everyone who can see that person’s people data reads them.";

/** The toolbar's New field at the limit: grey (B8), with why. */
export const FIELDS_FULL_TITLE = `Up to ${MAX_PROFILE_FIELDS} profile fields.`;

export function ProfileFieldsManager() {
  const confirm = useConfirm();
  const [fields, setFields] = useState<ProfileFieldDef[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  // Each press of New field, so the name field takes focus again even while its row is open.
  const [addPress, setAddPress] = useState(0);
  const [save, setSave] = useState<SaveState>("idle");
  const newRef = useRef<HTMLInputElement>(null);
  // Changes still out, and whether any of them was refused since the list was last read.
  const out = useRef(0);
  const refused = useRef(false);

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
    out.current += 1;
    const r = await recordWriteQueue().write("PUT", "/api/people/profile-fields", { fields: next }, {
      onRetrying: () => setSave("retrying"),
    });
    out.current -= 1;
    if (!r.ok) {
      refused.current = true;
      setSave({ error: r.error || "Not saved" });
    } else if (!refused.current) {
      setSave("saved");
    }
    if (out.current > 0 || !refused.current) return;
    // The last change is back and one was refused: the list as the server
    // holds it now, or the one from before this change when that read fails.
    refused.current = false;
    const read = await apiFetch<{ fields: ProfileFieldDef[] }>("/api/people/profile-fields", { cache: "no-store" });
    if (out.current > 0) return;
    setFields(read.ok ? read.data.fields : prev);
  }

  function add() {
    if (!fields) return;
    const label = draft.trim();
    if (!label) return;
    if (fields.some((f) => f.label.toLowerCase() === label.toLowerCase())) { setSave({ error: `There is already a field named ${label}` }); return; }
    setDraft("");
    setAdding(false);
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

  const full = fields.length >= MAX_PROFILE_FIELDS;
  const openAdd = () => { setAdding(true); setAddPress((n) => n + 1); };
  return (
    <>
      {canEdit ? <SettingsToolbar primary={{ label: "New field", onClick: openAdd, disabled: full, title: full ? FIELDS_FULL_TITLE : undefined }} /> : null}
      <ProfileFieldsCard
        fields={fields}
        canEdit={canEdit}
        save={save}
        draft={draft}
        onDraft={setDraft}
        adding={adding}
        addPress={addPress}
        onOpenAdd={openAdd}
        onCancelAdd={() => { setAdding(false); setDraft(""); }}
        onAdd={add}
        onRename={rename}
        onMove={move}
        onRemove={(i) => { void remove(i); }}
        newRef={newRef}
      />
    </>
  );
}

/** The card itself, from the manager's state (exported for its render test). */
export function ProfileFieldsCard({
  fields,
  canEdit,
  save,
  draft,
  onDraft,
  adding = false,
  addPress = 0,
  onOpenAdd,
  onCancelAdd,
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
  /** The name row is open (the toolbar's New field, or Add one). */
  adding?: boolean;
  /** Each press of New field: the name field takes focus again. */
  addPress?: number;
  onOpenAdd?: () => void;
  onCancelAdd?: () => void;
  onAdd: () => void;
  onRename: (i: number, label: string) => void;
  onMove: (i: number, by: -1 | 1) => void;
  onRemove: (i: number) => void;
  newRef?: RefObject<HTMLInputElement | null>;
}) {
  const canAdd = canEdit && fields.length < MAX_PROFILE_FIELDS;
  const rowOpen = canAdd && adding;
  useEffect(() => {
    if (rowOpen) newRef?.current?.focus();
  }, [rowOpen, addPress, newRef]);
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
          {canAdd && !rowOpen ? (
            <>
              {" · "}
              <button type="button" className="text-brand-deep hover:underline" onClick={onOpenAdd}>Add one</button>
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
      {rowOpen ? (
        <div className="flex w-full max-w-[560px] items-center gap-2">
          <input
            ref={newRef}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onAdd(); }
              if (e.key === "Escape") onCancelAdd?.();
            }}
            placeholder="New field name"
            aria-label="New field name"
            maxLength={60}
            className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--os-focus-halo)]"
          />
          <button type="button" disabled={!draft.trim()} onClick={onAdd} className={cn(btn.secondary, "h-9 shrink-0")}>
            <Plus className="h-4 w-4" aria-hidden /> Add field
          </button>
          <button type="button" onClick={onCancelAdd} className={cn(btn.ghost, "h-9 shrink-0")}>
            Cancel
          </button>
        </div>
      ) : null}
      {canEdit && fields.length >= MAX_PROFILE_FIELDS ? <p className="m-0 text-sm text-ink-2">{FIELDS_FULL_TITLE}</p> : null}
    </SettingsCard>
  );
}
