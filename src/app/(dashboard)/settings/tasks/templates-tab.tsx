"use client";

// Task system > Templates (spec-settings-workspace `/settings/tasks`): not a
// second builder. One link card into the Template Center, the org's default
// task type for new tasks (ItemType.isDefault, the same value the Task types
// tab's Default column sets; the create-task modal reads it), and the answer
// to "where are statuses and custom fields": on each List, carried by a List
// template. No primary on this tab.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { useOsToast } from "@/components/layout/os/toast";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { NativeSelect } from "@/components/settings/settings-form";
import { ErrorState } from "@/components/ui/error-state";
import { DotsArt } from "@/components/ui/dots-art";

type ApiType = { id: string; singular: string; isDefault: boolean };

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
  const setDefault = async (id: string) => {
    if (!id || id === current) return;
    setBusy(true);
    setRowError(null);
    const r = await apiFetch(`/api/item-types/${id}`, { method: "PATCH", json: { isDefault: true } });
    setBusy(false);
    if (!r.ok) { setRowError(r.error); return; }
    setSavedAt(Date.now());
    toast("Default task type saved");
    void load();
  };

  return (
    <SettingsCardStack>
      <SettingsCard id="tasks.templates">
        <div className="flex items-start gap-4">
          <DotsArt arrangement="stack" size={96} />
          <div className="flex flex-col gap-2">
            <p className="text-base text-ink">Templates live in the Template Center.</p>
            <Link href="/templates?scope=workspace" className="text-sm font-medium text-brand-deep hover:underline">Open the Template Center</Link>
          </div>
        </div>
        {error ? (
          <ErrorState compact what="the task types" hint={error} onRetry={() => { void load(); }} />
        ) : (
          <SettingsRow
            id="tasks.defaultType"
            label="Default task type for new tasks"
            helper="A List can have its own default in its ••• menu."
            savedAt={savedAt}
            error={rowError ? { message: rowError, onRetry: () => { void setDefault(current); } } : null}
            control={
              types ? (
                <NativeSelect
                  value={current}
                  options={types.map((t) => ({ value: t.id, label: t.singular }))}
                  onChange={(v) => { void setDefault(v); }}
                  disabled={busy}
                  ariaLabel="Default task type"
                />
              ) : null
            }
          />
        )}
      </SettingsCard>
      <SettingsCard title="Statuses and fields" id="tasks.statuses">
        <p className="text-base text-ink">Both belong to a List, so each team can run its own way: open a List, then its ••• menu › Statuses or Fields.</p>
        <p className="text-base text-ink-2">A List template carries both, so a company-wide default is a template you apply.</p>
        <Link href="/templates?scope=workspace&type=list" className="text-sm font-medium text-brand-deep hover:underline">Open the Template Center</Link>
      </SettingsCard>
    </SettingsCardStack>
  );
}
