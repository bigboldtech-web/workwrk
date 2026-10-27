"use client";

// Task system > Templates (spec-settings-workspace `/settings/tasks`): not a
// second builder. One card into the Template Center that holds the org's
// default task type for new tasks (ItemType.isDefault, the same value the
// Task types tab's Default column sets; the create-task modal reads it), and
// the answer to "where are statuses and custom fields": on each List,
// carried by a List template. No primary on this tab.
//
// THE SHARED PARTS (settings-cleanup Phase 6, B4 and B9): two SettingsCards,
// each a title, its line and its link as the card's action (the way Access's
// "How access works" carries "Manage people"), with no illustration: those
// are for empty states only (design-system 5.8). The default type is a
// SettingsRow with a PickerSelect, named by its visible label and its value;
// a click on the label opens it. Each link names where it goes, so the two
// never share one label for two places (B12).
//
// A FAILED READ NEVER SHOWS A TYPE (Phase 5 review, H1): it renders the
// compact ErrorState with Try again in the row's place, and the picker
// appears only over the list that was read, so no type that was never
// loaded can be shown or picked.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { useOsToast } from "@/components/layout/os/toast";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { PickerSelect } from "@/components/settings/picker-select";
import { btn } from "@/components/settings/settings-form";
import { ErrorState } from "@/components/ui/error-state";

type ApiType = { id: string; singular: string; isDefault: boolean };

/** The default type picker's id, for the row's <label htmlFor>. */
export const DEFAULT_TYPE_ID = "tasks-default-type";
export const DEFAULT_TYPE_LABEL = "Default task type for new tasks";

export function TemplatesTab() {
  const { toast } = useOsToast();
  const [types, setTypes] = useState<ApiType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const r = await apiFetch<{ types: ApiType[] }>("/api/item-types", { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setTypes(r.data.types ?? []);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const current = types?.find((t) => t.isDefault)?.id ?? "";
  // The last choice that failed, so Retry sends THAT choice again (the
  // shown value falls back to the stored one on failure).
  const [failedId, setFailedId] = useState<string | null>(null);
  const setDefault = async (id: string) => {
    if (!id || id === current) return;
    setBusy(true);
    setRowError(null);
    const r = await apiFetch(`/api/item-types/${id}`, { method: "PATCH", json: { isDefault: true } });
    setBusy(false);
    if (!r.ok) { setFailedId(id); setRowError(r.error); return; }
    setFailedId(null);
    setSavedAt(Date.now());
    toast("Default task type saved");
    void load();
  };

  return (
    <SettingsCardStack>
      <SettingsCard
        title="Templates"
        id="tasks.templates"
        description="Templates live in the Template Center. A new task starts as the type set here."
        actions={<Link href="/templates?kind=task" className={btn.link}>Open the Template Center</Link>}
      >
        {error ? (
          <ErrorState compact what="the task types" hint={error} onRetry={() => { void load(); }} />
        ) : (
          <SettingsRow
            id="tasks.defaultType"
            label={types ? <label htmlFor={DEFAULT_TYPE_ID}>{DEFAULT_TYPE_LABEL}</label> : DEFAULT_TYPE_LABEL}
            helper="A List can have its own default in its ••• menu."
            savedAt={savedAt}
            error={rowError ? { message: rowError, onRetry: () => { if (failedId) void setDefault(failedId); } } : null}
            control={
              types ? (
                <PickerSelect
                  id={DEFAULT_TYPE_ID}
                  label={DEFAULT_TYPE_LABEL}
                  value={current}
                  options={types.map((t) => ({ value: t.id, label: t.singular }))}
                  // No stored default reads as a choice still to make, never as the first type.
                  placeholder="Choose a type"
                  onChange={(v) => { void setDefault(v); }}
                  disabled={busy}
                />
              ) : null
            }
          />
        )}
      </SettingsCard>
      <SettingsCard
        title="Statuses and fields"
        id="tasks.statuses"
        description="Both belong to a List, so each team can run its own way: open a List, then its ••• menu › Statuses or Fields. A List template carries both, so a company-wide default is a template you apply."
        actions={<Link href="/templates?kind=list" className={btn.link}>Open List templates</Link>}
      />
    </SettingsCardStack>
  );
}
