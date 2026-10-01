"use client";

// Workspace settings > API & webhooks (spec-settings-workspace
// `/settings/api`, settings-architecture 5.13). Owner page (every Admin until
// the Owner and Admin split).
//
//   API keys   the key engine at /api/keys: list, generate (plaintext shown
//              ONCE), edit the two rate limits (PATCH), revoke; revoked keys
//              are hidden until "Show revoked keys" is ticked
//   Webhooks   NOT in the tab row: it ships only after an end-to-end delivery
//              is verified (the spec's honesty rule); under "Show upcoming
//              features" one line says it is coming
//   AI keys    the workspace's own Anthropic key, only for orgs with the
//              Enterprise byok flag (the same card as Data > Retention)
//
// Footer: Integrations (/integrations), the catalogue every Member can
// browse and request from.

import { DateText } from "@/components/ui/date-text";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, TriangleAlert, X } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { ConfirmDialog, Field, NumberInput, Pending, TextInput, btn } from "@/components/settings/settings-form";
import { ByokManager } from "@/components/settings/byok-manager";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { Drawer } from "@/components/ui/drawer";
import { ErrorState } from "@/components/ui/error-state";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";

type Scope = "READ" | "WRITE" | "ADMIN";
type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  lastUsedAt: string | null;
  requestCount: number;
  revokedAt: string | null;
  createdAt: string;
  createdBy: { firstName: string | null; lastName: string | null } | null;
};

const SCOPES: { value: Scope; label: string; hint: string }[] = [
  { value: "READ", label: "Read", hint: "Read workspace data through the API." },
  { value: "WRITE", label: "Write", hint: "Create and update records." },
  { value: "ADMIN", label: "Admin", hint: "Everything, key management included. Give it sparingly." },
];
const SCOPE_LABEL: Record<Scope, string> = { READ: "Read", WRITE: "Write", ADMIN: "Admin" };

export default function ApiSettingsPage() {
  const { boot } = useBoot();
  const [byok, setByok] = useState(false);
  const [createSignal, setCreateSignal] = useState(0);
  useEffect(() => {
    void apiFetch<{ features: { byok?: boolean } }>("/api/organization/features").then((r) => { if (r.ok) setByok(!!r.data.features?.byok); });
  }, []);
  const tabs: SettingsTab[] = [
    { key: "keys", label: "API keys", primary: { label: "Generate key", onClick: () => setCreateSignal((n) => n + 1) } },
    ...(byok ? [{ key: "ai", label: "AI keys" }] : []),
  ];
  return (
    <SettingsPage pageKey="api" tabs={tabs} width="list" subtitle={`Keys for anything that connects to ${boot.org.name || "your workspace"} from outside.`}>
      {(tab) => (
        <div className="flex flex-col gap-4">
          {tab === "ai" && byok ? <ByokManager /> : <KeysTab createSignal={createSignal} />}
          <p className="text-sm"><Link href="/integrations" className="font-medium text-brand-deep hover:underline">Integrations</Link></p>
        </div>
      )}
    </SettingsPage>
  );
}

function KeysTab({ createSignal }: { createSignal: number }) {
  const { toast } = useOsToast();
  const showUpcoming = useShowUpcoming();
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["READ"]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; plaintext: string } | null>(null);
  const [open, setOpen] = useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await apiFetch<{ data: ApiKeyRow[] }>("/api/keys", { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setKeys(r.data.data ?? []);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    if (createSignal <= 0) return;
    const t = setTimeout(() => { setName(""); setScopes(["READ"]); setFormError(null); setCreateOpen(true); }, 0);
    return () => clearTimeout(t);
  }, [createSignal]);

  const rows = useMemo(() => (keys ? keys.filter((k) => showRevoked || !k.revokedAt) : null), [keys, showRevoked]);
  const revokedCount = keys?.filter((k) => k.revokedAt).length ?? 0;

  const create = async () => {
    if (!name.trim()) { setFormError("Give the key a name you will recognise."); return; }
    setBusy(true);
    setFormError(null);
    const r = await apiFetch<{ name: string; plaintext: string }>("/api/keys", { method: "POST", json: { name: name.trim(), scopes: scopes.length ? scopes : ["READ"] } });
    setBusy(false);
    if (!r.ok || !r.data?.plaintext) { setFormError(r.ok ? "The key was not returned. Try again." : r.error); return; }
    setCreateOpen(false);
    setRevealed({ name: r.data.name, plaintext: r.data.plaintext });
    void load();
  };
  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    const r = await apiFetch(`/api/keys?id=${encodeURIComponent(revoking.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) { toast(r.error); return; }
    setRevoking(null);
    setOpen(null);
    toast("Key revoked");
    void load();
  };

  const columns: TableColumn<ApiKeyRow>[] = [
    { key: "name", label: "Name", title: true, width: "minmax(180px,1.2fr)", render: (k) => k.name },
    { key: "prefix", label: "Prefix", width: "150px", render: (k) => <span className="font-mono text-sm">{k.prefix}</span> },
    { key: "scopes", label: "Scopes", width: "160px", render: (k) => k.scopes.map((s) => SCOPE_LABEL[s]).join(", ") },
    { key: "rate", label: "Rate limit", width: "170px", hideBelow: 900, render: (k) => `${k.rateLimitPerMinute}/min · ${k.rateLimitPerDay}/day` },
    { key: "used", label: "Last used", width: "120px", render: (k) => <DateText value={k.lastUsedAt} style="relative" fallback="Never" /> },
    { key: "by", label: "Created by", width: "150px", hideBelow: 1000, render: (k) => (k.createdBy ? `${k.createdBy.firstName ?? ""} ${k.createdBy.lastName ?? ""}`.trim() : "·") },
    { key: "status", label: "Status", width: "100px", render: (k) => (k.revokedAt ? <span className="text-danger-text">Revoked</span> : "Active") },
  ];

  if (error) return <ErrorState what="API keys" hint={error} onRetry={() => { void load(); }} />;

  return (
    <>
      <div className="flex min-h-11 items-center gap-2 rounded-lg bg-[var(--os-warning-bg)] px-4 py-2 text-sm text-ink">
        <TriangleAlert className="h-4 w-4 shrink-0 text-warning-text" strokeWidth={1.5} aria-hidden />
        A key acts as the person who made it and never gets more than they have. Revoking a key takes effect immediately.
      </div>
      <TableCard
        ariaLabel="API keys"
        columns={columns}
        rows={rows}
        rowKey={(k) => k.id}
        onRowClick={(k) => setOpen(k)}
        empty={
          <span>
            No API keys yet · <button type="button" className="text-brand-deep hover:underline" onClick={() => { setName(""); setScopes(["READ"]); setCreateOpen(true); }}>Generate a key</button>
          </span>
        }
        footer={
          rows
            ? {
                total: rows.length,
                noun: "keys",
                from: rows.length ? 1 : 0,
                to: rows.length,
                hidePaging: true,
                trailing: revokedCount > 0 ? (
                  <label className="inline-flex items-center gap-2 text-sm text-ink-2">
                    <input type="checkbox" className="h-4 w-4" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} />
                    Show revoked keys ({revokedCount})
                  </label>
                ) : undefined,
              }
            : undefined
        }
      />
      {showUpcoming ? <p className="text-sm text-ink-3">Coming soon: webhooks, once delivery is verified end to end.</p> : null}

      <ConfirmDialog open={createOpen} onOpenChange={setCreateOpen} title="Generate an API key" width={560} confirmLabel="Generate key" onConfirm={create} busy={busy} error={formError}>
        <Field label="Name" htmlFor="key-name" required helper="Where it is used, so you know what breaks if it is revoked.">
          <TextInput id="key-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-ink">Scopes</legend>
          {SCOPES.map((s) => (
            <label key={s.value} className="flex items-start gap-3 rounded-lg border border-line p-3">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={scopes.includes(s.value)} onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s.value] : cur.filter((x) => x !== s.value)))} />
              <span><span className="block text-base font-medium text-ink">{s.label}</span><span className="text-sm text-ink-2">{s.hint}</span></span>
            </label>
          ))}
          <p className="text-sm text-ink-2">Scopes cannot be changed after a key is made. Make a new key instead.</p>
        </fieldset>
      </ConfirmDialog>

      <ConfirmDialog open={!!revealed} onOpenChange={(v) => { if (!v) setRevealed(null); }} title="Copy your new key" width={560} confirmLabel="Done, I have saved it" onConfirm={() => setRevealed(null)}>
        <p>This is the only time {revealed?.name ? `"${revealed.name}"` : "the key"} is shown. Store it somewhere safe now.</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md border border-line bg-hover px-3 py-2 font-mono text-sm">{revealed?.plaintext}</code>
          <button type="button" className={btn.secondary} onClick={() => { if (revealed) void navigator.clipboard?.writeText(revealed.plaintext).then(() => toast("Key copied")); }}>
            <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Copy
          </button>
        </div>
      </ConfirmDialog>

      {open ? <KeyDrawer k={open} onClose={() => setOpen(null)} onRevoke={() => setRevoking(open)} onSaved={() => { void load(); }} /> : null}

      <ConfirmDialog open={!!revoking} onOpenChange={(v) => { if (!v) setRevoking(null); }} title="Revoke this key?" danger confirmLabel="Revoke key" onConfirm={revoke} busy={busy}>
        <p>Anything using &quot;{revoking?.name}&quot; stops working at once. This cannot be undone.</p>
      </ConfirmDialog>
    </>
  );
}

function KeyDrawer({ k, onClose, onRevoke, onSaved }: { k: ApiKeyRow; onClose: () => void; onRevoke: () => void; onSaved: () => void }) {
  const { toast } = useOsToast();
  const [perMin, setPerMin] = useState<number | "">(k.rateLimitPerMinute);
  const [perDay, setPerDay] = useState<number | "">(k.rateLimitPerDay);
  const [saving, setSaving] = useState(false);
  const dirty = perMin !== k.rateLimitPerMinute || perDay !== k.rateLimitPerDay;
  const save = async () => {
    if (perMin === "" || perDay === "") return;
    setSaving(true);
    const r = await apiFetch("/api/keys", { method: "PATCH", json: { id: k.id, rateLimitPerMinute: perMin, rateLimitPerDay: perDay } });
    setSaving(false);
    if (!r.ok) { toast(r.error); return; }
    toast("Rate limits saved");
    onSaved();
  };
  return (
    <Drawer
      open
      onClose={onClose}
      width={520}
      layerId="api-key-drawer"
      ariaLabel="API key"
      header={
        <>
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{k.name}</span>
          <button type="button" aria-label="Close" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><X className="h-4 w-4" strokeWidth={1.5} /></button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-base">
          <dt className="text-ink-2">Prefix</dt><dd className="font-mono text-sm">{k.prefix}</dd>
          <dt className="text-ink-2">Scopes</dt><dd>{k.scopes.map((s) => SCOPE_LABEL[s]).join(", ")}</dd>
          <dt className="text-ink-2">Created</dt><dd><DateText value={k.createdAt} />{k.createdBy ? ` by ${`${k.createdBy.firstName ?? ""} ${k.createdBy.lastName ?? ""}`.trim()}` : ""}</dd>
          <dt className="text-ink-2">Requests</dt><dd className="tabular-nums">{k.requestCount}</dd>
          <dt className="text-ink-2">Status</dt><dd>{k.revokedAt ? <>Revoked <DateText value={k.revokedAt} /></> : "Active"}</dd>
        </dl>
        <p className="text-sm text-ink-2">Scopes cannot be changed after a key is made. Make a new key instead.</p>
        {k.revokedAt ? null : (
          <>
            <div className="flex flex-wrap items-center gap-4">
              <Field label="Requests a minute"><NumberInput value={perMin} min={1} max={10000} onChange={setPerMin} ariaLabel="Requests a minute" /></Field>
              <Field label="Requests a day"><NumberInput value={perDay} min={1} max={10000000} width={120} onChange={setPerDay} ariaLabel="Requests a day" /></Field>
            </div>
            <div className="flex gap-2">
              {dirty ? (
                <button type="button" className={btn.secondary} disabled={saving} onClick={() => { void save(); }}>
                  {saving ? <Pending label="Saving" /> : null}
                  Save limits
                </button>
              ) : null}
              <button type="button" className={btn.dangerGhost} onClick={onRevoke}>Revoke</button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
