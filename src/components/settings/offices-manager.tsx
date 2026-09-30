"use client";

// Structure > Offices (spec-settings-workspace `/settings/structure`): real
// CRUD over the Office model that replaces the "Coming soon" tile. GET, POST,
// PATCH and DELETE /api/offices (which existed with no settings door). One
// headquarters: marking one clears the others on the server. An office with
// people in it is never deleted (the API refuses and says so); its people
// are moved first on their records.
//
// The row actions are visible at rest (no hover-only affordance, settings
// spec 1.6). `canEdit` false renders the table as text with no actions (the
// People team's read-only view, access 5.4).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useOsToast } from "@/components/layout/os/toast";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { ErrorState } from "@/components/ui/error-state";
import { PickerSelect } from "@/components/settings/picker-select";
import { ConfirmDialog, Field, TextInput } from "@/components/settings/settings-form";

export interface OfficeRow {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  timezone: string | null;
  address: string | null;
  isHeadquarters: boolean;
  _count?: { members: number };
}

type Draft = { id?: string; name: string; city: string; country: string; timezone: string; isHeadquarters: boolean };
const EMPTY: Draft = { name: "", city: "", country: "", timezone: "", isHeadquarters: false };

function zones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return fn ? fn("timeZone") : [];
  } catch {
    return [];
  }
}

export function OfficesManager({ canEdit, createSignal }: { canEdit: boolean; createSignal: number }) {
  const { toast } = useOsToast();
  const [rows, setRows] = useState<OfficeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OfficeRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await apiFetch<OfficeRow[]>("/api/offices", { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setRows(Array.isArray(r.data) ? r.data : []);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);
  // The page toolbar's "New office" is this tab's one primary.
  useEffect(() => {
    if (createSignal <= 0) return;
    const t = setTimeout(() => { setFormError(null); setDraft({ ...EMPTY }); }, 0);
    return () => clearTimeout(t);
  }, [createSignal]);

  const zoneOptions = useMemo(() => [{ value: "", label: "Not set" }, ...zones().map((z) => ({ value: z, label: z.replace(/_/g, " "), keywords: z }))], []);

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setFormError("Office name is required"); return; }
    setSaving(true);
    setFormError(null);
    const body = {
      name: draft.name.trim(),
      city: draft.city.trim() || null,
      country: draft.country.trim() || null,
      timezone: draft.timezone || null,
      isHeadquarters: draft.isHeadquarters,
    };
    const r = draft.id
      ? await apiFetch("/api/offices", { method: "PATCH", json: { id: draft.id, ...body } })
      : await apiFetch("/api/offices", { method: "POST", json: body });
    setSaving(false);
    if (!r.ok) { setFormError(r.error); return; }
    setDraft(null);
    toast(draft.id ? "Office saved" : "Office added");
    void load();
  };

  const remove = async () => {
    if (!deleting) return;
    setSaving(true);
    const r = await apiFetch("/api/offices", { method: "DELETE", json: { id: deleting.id } });
    setSaving(false);
    if (!r.ok) { setFormError(r.error); return; }
    setDeleting(null);
    toast("Office deleted");
    void load();
  };

  const columns: TableColumn<OfficeRow>[] = [
    { key: "name", label: "Name", title: true, width: "minmax(200px,1.4fr)", render: (o) => o.name },
    { key: "city", label: "City", render: (o) => o.city || "·" },
    { key: "country", label: "Country", render: (o) => o.country || "·", hideBelow: 700 },
    { key: "tz", label: "Time zone", render: (o) => (o.timezone ? o.timezone.replace(/_/g, " ") : "·"), hideBelow: 820 },
    { key: "hq", label: "Headquarters", width: "130px", render: (o) => (o.isHeadquarters ? "Headquarters" : "") },
    { key: "members", label: "Members", numeric: true, width: "100px", render: (o) => o._count?.members ?? 0 },
  ];

  if (error) return <ErrorState what="offices" hint={error} onRetry={() => { void load(); }} />;

  return (
    <>
      <TableCard
        ariaLabel="Offices"
        columns={columns}
        rows={rows}
        rowKey={(o) => o.id}
        rowMenuAlwaysVisible
        rowMenuWidth={canEdit ? 84 : 44}
        rowMenu={
          canEdit
            ? (o) => (
                <span className="flex items-center gap-1">
                  <button type="button" aria-label={`Edit ${o.name}`} title="Edit" onClick={() => { setFormError(null); setDraft({ id: o.id, name: o.name, city: o.city ?? "", country: o.country ?? "", timezone: o.timezone ?? "", isHeadquarters: o.isHeadquarters }); }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
                    <Pencil className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                  <button type="button" aria-label={`Delete ${o.name}`} title="Delete" onClick={() => { setFormError(null); setDeleting(o); }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-danger-text">
                    <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </span>
              )
            : undefined
        }
        empty={
          <span>
            No offices yet
            {canEdit ? (
              <>
                {" · "}
                <button type="button" className="text-brand-deep hover:underline" onClick={() => { setFormError(null); setDraft({ ...EMPTY }); }}>Add an office</button>
              </>
            ) : null}
          </span>
        }
        footer={rows ? { total: rows.length, noun: "offices", from: rows.length ? 1 : 0, to: rows.length, hidePaging: true } : undefined}
      />

      <ConfirmDialog
        open={!!draft}
        onOpenChange={(v) => { if (!v) setDraft(null); }}
        title={draft?.id ? "Edit office" : "New office"}
        width={560}
        confirmLabel={draft?.id ? "Save office" : "Add office"}
        onConfirm={save}
        busy={saving}
        error={formError}
      >
        {draft ? (
          <>
            <Field label="Name" htmlFor="of-name" required>
              <TextInput id="of-name" value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="City" htmlFor="of-city">
                <TextInput id="of-city" value={draft.city} maxLength={120} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
              </Field>
              <Field label="Country" htmlFor="of-country">
                <TextInput id="of-country" value={draft.country} maxLength={120} onChange={(e) => setDraft({ ...draft, country: e.target.value })} />
              </Field>
            </div>
            <Field label="Time zone">
              <PickerSelect label="Office time zone" value={draft.timezone} options={zoneOptions} onChange={(v) => setDraft({ ...draft, timezone: v })} width={320} />
            </Field>
            <label className="flex items-center gap-2 text-base text-ink">
              <input type="checkbox" className="h-4 w-4" checked={draft.isHeadquarters} onChange={(e) => setDraft({ ...draft, isHeadquarters: e.target.checked })} />
              This is the headquarters
            </label>
          </>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => { if (!v) setDeleting(null); }}
        title="Delete this office?"
        danger
        confirmLabel="Delete office"
        onConfirm={remove}
        busy={saving}
        error={formError}
      >
        {deleting && (deleting._count?.members ?? 0) > 0 ? (
          <p>{deleting.name} has {deleting._count?.members} {deleting._count?.members === 1 ? "person" : "people"} in it. Move them to another office on their records first; the office is not deleted while anyone is in it.</p>
        ) : (
          <p>{deleting?.name} is removed. Nobody works from it, so no record changes.</p>
        )}
      </ConfirmDialog>
    </>
  );
}
