"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { KeyRound, Loader2, Check, Trash2, Crown } from "lucide-react";
import { BloomMark } from "@/components/layout/os/bloom-mark";

interface KeyState {
  enabled: boolean;
  reason?: string;
  key: {
    keyHint: string | null;
    lastUsedAt: string | null;
    preferredModel: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

const MODELS = [
  { value: "", label: "Default (per-feature)" },
  { value: "claude-sonnet-4-20250514", label: "Sonnet 4 (balanced)" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (fast, cheap)" },
];

/**
 * Customer-side UI for plugging in an Anthropic key. Gated behind
 * the BYOK Enterprise add-on by the API; this component shows the
 * upsell card if the feature is off.
 */
export function ByokManager() {
  const { success: toastSuccess, error: toastError } = useToast();
  const confirm = useConfirm();
  const [state, setState] = useState<KeyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [preferredModel, setPreferredModel] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/organization/byok");
    if (r.ok) {
      const d = await r.json();
      const data = (d.data ?? d) as KeyState;
      setState(data);
      setPreferredModel(data.key?.preferredModel ?? "");
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/organization/byok", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          preferredModel: preferredModel || null,
        }),
      });
      if (res.ok) {
        toastSuccess("Key saved & verified");
        setApiKey("");
        await load();
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to save key");
      }
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    if (!(await confirm({
      title: "Revoke this Anthropic key?",
      description: "AI features will fall back to the WorkwrK shared key. Your key isn't deleted from Anthropic — only from this org's settings.",
      confirmLabel: "Revoke key",
      destructive: true,
    }))) return;
    const res = await fetch("/api/organization/byok", { method: "DELETE" });
    if (res.ok) {
      toastSuccess("Key revoked");
      await load();
    } else {
      toastError("Failed to revoke key");
    }
  }

  if (loading) {
    return (
      <Card><CardContent className="p-8 text-center text-sm text-muted">
        <Loader2 size={16} className="animate-spin mx-auto mb-2" /> Loading…
      </CardContent></Card>
    );
  }

  // Upsell card if BYOK isn't enabled.
  if (!state?.enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BloomMark size={14} /> AI &amp; Integrations
          </CardTitle>
          <CardDescription>
            Plug in your own Anthropic API key for AI features. AI calls stop using
            WorkwrK&rsquo;s shared key and start using yours, billed directly to your
            Anthropic account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-border bg-surface-2 p-6 text-center">
            <Crown size={20} className="mx-auto text-muted mb-2" />
            <p className="text-sm font-medium">Enterprise add-on</p>
            <p className="text-[12px] text-muted mt-1 max-w-md mx-auto">
              BYOK is a custom add-on we enable per Enterprise customer. Reach out to
              your WorkwrK contact and we&rsquo;ll switch it on.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasKey = !!state.key?.keyHint;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <BloomMark size={14} /> AI &amp; Integrations
        </CardTitle>
        <CardDescription>
          AI features (organisation chat, SOP/KRA generation, profile generation)
          will use your key when one is set. Falls back to the WorkwrK shared key
          if not.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasKey && (
          <div className="rounded-lg border border-border bg-surface-2 p-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-[rgba(34,197,94,0.10)] border border-[rgba(34,197,94,0.30)] flex items-center justify-center shrink-0">
              <Check size={14} className="text-green-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Anthropic key active</div>
              <div className="text-[11px] text-muted font-mono">
                {state.key?.keyHint}
                {state.key?.lastUsedAt && ` · last used ${new Date(state.key.lastUsedAt).toLocaleString()}`}
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 text-red-400 hover:text-red-300" onClick={revoke}>
              <Trash2 size={12} /> Revoke
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <Label>{hasKey ? "Replace key" : "Anthropic API key"}</Label>
          <div className="flex items-center gap-2">
            <KeyRound size={14} className="text-muted shrink-0" />
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-…"
              className="font-mono"
            />
          </div>
          <p className="text-[11px] text-muted">
            We&rsquo;ll test the key against Anthropic before saving. Stored encrypted at rest with AES-256-GCM.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Preferred model</Label>
          <Select value={preferredModel} onValueChange={setPreferredModel}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.value || "default"} value={m.value || "default"}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted">
            Override which Claude model is used for your org. Default lets each
            feature pick the right model (cheap for SOP/KRA generation, balanced
            for chat).
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <span className="text-[11px] text-muted">
            {hasKey ? "Save updates the stored key with the new value." : "Saving runs a free test call against Anthropic."}
          </span>
          <Button onClick={save} disabled={saving || !apiKey.trim()} className="gap-1.5">
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}
            {hasKey ? "Replace key" : "Save key"}
          </Button>
        </div>

        {!!state.key?.preferredModel && state.key.preferredModel !== preferredModel && (
          <Badge variant="outline" className="text-[10px]">
            Currently using {state.key.preferredModel}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
