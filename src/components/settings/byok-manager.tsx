"use client";

// Bring your own AI key (settings-architecture 5.10 Retention & privacy,
// 5.13 AI keys): an Anthropic key the workspace's AI features use instead of
// WorkwrK's shared one (read by src/lib/ai-client.ts). Enterprise add-on
// only: the caller mounts this for orgs with the `byok` flag; the API refuses
// everyone else. The key is write-only: after saving, only its hint shows.
//
//   GET    /api/organization/byok   { enabled, key: { keyHint, lastUsedAt, preferredModel } }
//   PUT    /api/organization/byok   { apiKey, preferredModel } (tested against Anthropic first)
//   DELETE /api/organization/byok

import { DateText } from "@/components/ui/date-text";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useOsToast } from "@/components/layout/os/toast";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { ConfirmDialog, Field, NativeSelect, Pending, TextInput, btn } from "@/components/settings/settings-form";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";

interface KeyState {
  enabled: boolean;
  reason?: string;
  key: { keyHint: string | null; lastUsedAt: string | null; preferredModel: string | null } | null;
}

const MODELS = [
  { value: "", label: "Default (each feature picks)" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6 (balanced)" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (fast)" },
];

export function ByokManager() {
  const { toast } = useOsToast();
  const [state, setState] = useState<KeyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const r = await apiFetch<KeyState>("/api/organization/byok", { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setState(r.data);
    setModel(r.data.key?.preferredModel ?? "");
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const save = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setSaveError(null);
    const r = await apiFetch("/api/organization/byok", { method: "PUT", json: { apiKey: apiKey.trim(), preferredModel: model || null } });
    setSaving(false);
    if (!r.ok) { setSaveError(r.error); return; }
    setApiKey("");
    toast("Key saved and tested");
    void load();
  };
  const revoke = async () => {
    setSaving(true);
    const r = await apiFetch("/api/organization/byok", { method: "DELETE" });
    setSaving(false);
    if (!r.ok) { setSaveError(r.error); return; }
    setRevokeOpen(false);
    toast("Key removed");
    void load();
  };

  if (error) return <ErrorState what="the AI key" hint={error} onRetry={() => { void load(); }} />;
  if (!state) return <SkeletonRows rows={3} className="max-w-[560px]" />;
  if (!state.enabled) return null;
  const hasKey = !!state.key?.keyHint;

  return (
    <SettingsCard title="Bring your own AI key" description="AI features use your Anthropic key when one is set, and WorkwrK's shared key when not." id="data.byok">
      {hasKey ? (
        <SettingsRow
          label="Anthropic key"
          helper={<>{state.key?.keyHint ?? ""}{state.key?.lastUsedAt ? <> · last used <DateText value={state.key.lastUsedAt} /></> : null}</>}
          control={<button type="button" className={btn.dangerGhost} onClick={() => setRevokeOpen(true)}>Remove</button>}
        />
      ) : null}
      <Field label={hasKey ? "Replace the key" : "Anthropic API key"} htmlFor="byok-key" helper="Tested against Anthropic before it is saved. Stored encrypted.">
        <TextInput id="byok-key" type="password" autoComplete="off" value={apiKey} placeholder="sk-ant-" onChange={(e) => setApiKey(e.target.value)} className="font-mono" />
      </Field>
      <Field label="Preferred model" htmlFor="byok-model">
        <NativeSelect id="byok-model" value={model} options={MODELS} onChange={setModel} />
      </Field>
      {saveError ? <p role="alert" className="text-sm text-danger-text">{saveError}</p> : null}
      <div>
        <button type="button" className={btn.secondary} disabled={saving || !apiKey.trim()} onClick={() => { void save(); }}>
          {saving ? <Pending label="Testing" /> : null}
          {hasKey ? "Replace and test" : "Save and test"}
        </button>
      </div>
      <ConfirmDialog open={revokeOpen} onOpenChange={setRevokeOpen} title="Remove the AI key?" danger confirmLabel="Remove key" onConfirm={revoke} busy={saving}>
        <p>AI features go back to WorkwrK&apos;s shared key. The key itself stays valid at Anthropic; only this workspace forgets it.</p>
      </ConfirmDialog>
    </SettingsCard>
  );
}
