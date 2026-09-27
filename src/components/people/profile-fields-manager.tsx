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

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { recordWriteQueue } from "@/lib/people/record-write-queue";
import { keyForLabel, MAX_PROFILE_FIELDS, type ProfileFieldDef } from "@/lib/people/profile-fields";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/dialog-provider";

type SaveState = "idle" | "saving" | "saved" | "retrying" | { error: string };

export function ProfileFieldsManager() {
  const confirm = useConfirm();
  const [fields, setFields] = useState<ProfileFieldDef[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [save, setSave] = useState<SaveState>("idle");

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
  if (!fields) return <div className="px-6 pt-4"><SkeletonRows rows={3} rowHeight="44px" /></div>;

  return (
    <div className="os-chrome flex max-w-2xl flex-col gap-3 px-6 pb-10 pt-3">
      <p className="text-base text-ink-2">
        Extra fields on every person&rsquo;s record, like Employee ID or Pronouns. Whoever can edit a person&rsquo;s job title and department fills them in from Edit details; everyone who can see that person&rsquo;s people data reads them.
      </p>
      <div className="flex h-5 items-center text-sm" aria-live="polite">
        {save === "saving" ? <span className="text-ink-2">Saving</span> : null}
        {save === "saved" ? <span className="text-ink-2">Saved</span> : null}
        {save === "retrying" ? <span className="text-danger-text">Not saved, retrying</span> : null}
        {typeof save === "object" ? <span role="alert" className="text-danger-text">{save.error}</span> : null}
      </div>
      {fields.length === 0 ? (
        <p className="rounded-lg border border-line bg-raised px-4 py-3 text-row text-ink-2">No profile fields yet.</p>
      ) : (
        <ul className="rounded-lg border border-line bg-raised">
          {fields.map((f, i) => (
            <li key={`${f.key}:${f.label}`} className="flex min-h-11 items-center gap-2 border-b border-line-soft px-3 last:border-b-0">
              {canEdit ? (
                <input
                  defaultValue={f.label}
                  aria-label={`Field name ${i + 1}`}
                  maxLength={60}
                  onBlur={(e) => rename(i, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-row text-ink hover:border-line focus:border-brand focus:outline-none"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate px-2 text-row text-ink">{f.label}</span>
              )}
              {canEdit ? (
                <>
                  <button type="button" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => move(i, -1)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label={`Move ${f.label} down`} disabled={i === fields.length - 1} onClick={() => move(i, 1)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"><ArrowDown className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label={`Remove ${f.label}`} onClick={() => void remove(i)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-danger-text"><X className="h-3.5 w-3.5" /></button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit && fields.length < MAX_PROFILE_FIELDS ? (
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="New field name"
            aria-label="New field name"
            maxLength={60}
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-sm text-ink focus:border-brand focus:outline-none"
          />
          <button type="button" disabled={!draft.trim()} onClick={add} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-medium text-ink-inv hover:bg-brand-hover disabled:opacity-50">
            <Plus className="h-4 w-4" aria-hidden /> Add field
          </button>
        </div>
      ) : null}
      {canEdit && fields.length >= MAX_PROFILE_FIELDS ? <p className="text-sm text-ink-2">Up to {MAX_PROFILE_FIELDS} profile fields.</p> : null}
    </div>
  );
}
