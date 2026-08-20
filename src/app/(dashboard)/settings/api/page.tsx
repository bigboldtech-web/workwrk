"use client";

/* Settings · API keys — manage org-wide API keys.
 *
 * This page is a thin client over the production key engine at /api/keys:
 *   GET    /api/keys        — list org keys (plaintext never returned)
 *   POST   /api/keys        — mint a key; plaintext returned ONCE
 *   DELETE /api/keys?id=    — revoke (soft delete via revokedAt)
 * Admin-only, mirroring the route's own SUPER_ADMIN / COMPANY_ADMIN gate.
 * There is NO client-side key fabrication and NO local-only revoke: every
 * row, secret, and revocation round-trips the real backend. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Key, Plus, Copy, Trash2, Hash, Activity, Clock, ShieldCheck,
  AlertTriangle, Search, Loader2, Ban, Lock, Check,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useRole } from "@/hooks/use-role";

type Scope = "READ" | "WRITE" | "ADMIN";

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  requestCount: number;
  revokedAt: string | null;
  createdAt: string;
  createdBy: { firstName: string | null; lastName: string | null } | null;
};

const SCOPE_OPTIONS: { value: Scope; label: string; hint: string }[] = [
  { value: "READ", label: "Read", hint: "Read organization data through the API" },
  { value: "WRITE", label: "Write", hint: "Create and update records" },
  { value: "ADMIN", label: "Admin", hint: "Full administrative access — grant sparingly" },
];

function relativeDate(iso?: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h ago`;
  if (ms < 7 * day) return `${Math.floor(ms / day)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initialsOf(u: ApiKeyRow["createdBy"]): string {
  if (!u) return "—";
  const a = (u.firstName ?? "").trim();
  const b = (u.lastName ?? "").trim();
  const s = `${a.charAt(0)}${b.charAt(0)}`.toUpperCase();
  return s || "—";
}

export default function ApiKeysPage() {
  const { accessLevel } = useRole();
  const canManage = accessLevel === "COMPANY_ADMIN" || accessLevel === "SUPER_ADMIN";

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Create-key modal
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newScopes, setNewScopes] = useState<Scope[]>(["READ"]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Reveal-once secret (never persisted; cleared when the dialog closes)
  const [revealed, setRevealed] = useState<{ name: string; prefix: string; plaintext: string } | null>(null);
  const [revealCopied, setRevealCopied] = useState(false);

  const { toast } = useOsToast();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/keys");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Failed to load API keys");
      setKeys((body?.data ?? []) as ApiKeyRow[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load API keys");
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) void load();
    else setLoading(false);
  }, [canManage, load]);

  const stats = useMemo(() => {
    const live = keys.filter((k) => !k.revokedAt);
    const active = live.filter(
      (k) => k.lastUsedAt && Date.now() - new Date(k.lastUsedAt).getTime() < 7 * 86_400_000,
    ).length;
    const stale = live.filter(
      (k) => !k.lastUsedAt || Date.now() - new Date(k.lastUsedAt).getTime() > 30 * 86_400_000,
    ).length;
    const revoked = keys.filter((k) => k.revokedAt).length;
    return { total: live.length, active, stale, revoked };
  }, [keys]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter(
      (k) => k.name.toLowerCase().includes(q) || k.prefix.toLowerCase().includes(q),
    );
  }, [keys, search]);

  function toggleScope(s: Scope) {
    setNewScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  function openCreate() {
    setNewName("");
    setNewScopes(["READ"]);
    setCreateError(null);
    setCreateOpen(true);
  }

  async function submitCreate() {
    const name = newName.trim();
    if (!name) {
      setCreateError("Give the key a name so you can recognize it later.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes: newScopes.length ? newScopes : ["READ"] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.plaintext) {
        throw new Error(body?.error ?? "Could not create the key.");
      }
      setCreateOpen(false);
      setRevealCopied(false);
      setRevealed({ name: body.name, prefix: body.prefix, plaintext: body.plaintext });
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create the key.");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(k: ApiKeyRow) {
    if (k.revokedAt) return;
    const ok = await confirm({
      title: "Revoke key",
      description: `Revoke “${k.name}”? Any service using it will immediately stop working. This cannot be undone.`,
      destructive: true,
      confirmLabel: "Revoke",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/keys?id=${encodeURIComponent(k.id)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not revoke the key.");
      toast("Key revoked");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not revoke the key.");
    }
  }

  function copyText(text: string, label: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      toast(label);
    }
  }

  function copyRevealed() {
    if (!revealed) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(revealed.plaintext);
      setRevealCopied(true);
      toast("Key copied — store it now");
    }
  }

  return (
    <>
      <OsTitleBar
        title="API keys"
        Icon={Key}
        iconGradient={GRAD.indigoBlue}
        description={
          canManage
            ? `${stats.total} active · ${stats.active} used this week · ${stats.revoked} revoked`
            : "Organization API access"
        }
        actions={
          <div className="apk__head-actions">
            <Link href="/settings" className="apk__nav-link"><Hash /> Settings</Link>
            <Link href="/settings/audit" className="apk__nav-link"><Activity /> Audit</Link>
            {canManage ? (
              <button type="button" className="apk__btn-primary" onClick={openCreate}>
                <Plus /> Generate key
              </button>
            ) : null}
          </div>
        }
      />

      <div className="apk">
        {!canManage ? (
          <div className="apk__warn" role="status">
            <Lock />
            <span>
              <strong>Admins only.</strong> API keys are managed by organization
              administrators. Ask a company admin if you need programmatic access.
            </span>
          </div>
        ) : (
          <>
            <div className="apk__kpis">
              <KpiTile accent="var(--os-brand)"    Icon={Key}      label="Active"  value={`${stats.total}`}   sub="live keys" />
              <KpiTile accent="var(--os-c-green)"  Icon={Activity} label="In use"  value={`${stats.active}`}  sub="used in 7d" />
              <KpiTile accent="var(--os-c-orange)" Icon={Clock}    label="Stale"   value={`${stats.stale}`}   sub="> 30d unused" />
              <KpiTile accent="var(--os-c-red)"    Icon={Ban}      label="Revoked" value={`${stats.revoked}`} sub="disabled" />
            </div>

            <div className="apk__warn">
              <ShieldCheck />
              <span>
                <strong>A key&apos;s secret is shown once, at creation.</strong> Store it in a
                secret manager — there is no way to recover it later. Only the prefix is kept.
              </span>
            </div>

            <div className="apk__toolbar">
              <div className="apk__search">
                <Search />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search keys…"
                />
              </div>
            </div>

            {loading ? (
              <div className="apk__loading"><Loader2 className="animate-spin" /> Loading keys…</div>
            ) : loadError ? (
              <div className="apk__no-match"><AlertTriangle /> {loadError}</div>
            ) : keys.length === 0 ? (
              <OsEmptyView
                Icon={Key}
                iconGradient={GRAD.indigoBlue}
                title="No API keys yet"
                subtitle="Generate a key to access the WorkwrK API from scripts, webhooks, or integrations."
                chips={["read", "write", "admin"]}
                cta="Generate key"
                onCta={openCreate}
              />
            ) : filtered.length === 0 ? (
              <div className="apk__no-match"><Search /> No keys match.</div>
            ) : (
              <div className="apk__table">
                <div className="apk__row apk__row--head">
                  <span>Name</span>
                  <span>Key prefix</span>
                  <span>Scopes</span>
                  <span>Last used</span>
                  <span>Created</span>
                  <span></span>
                </div>
                {filtered.map((k) => {
                  const isRevoked = !!k.revokedAt;
                  const stale =
                    !isRevoked &&
                    (!k.lastUsedAt || Date.now() - new Date(k.lastUsedAt).getTime() > 30 * 86_400_000);
                  const lastUsedTitle = k.lastUsedAt
                    ? `${new Date(k.lastUsedAt).toLocaleString()}${k.lastUsedIp ? ` · ${k.lastUsedIp}` : ""} · ${k.requestCount.toLocaleString()} request${k.requestCount === 1 ? "" : "s"}`
                    : "Never used";
                  return (
                    <div key={k.id} className={`apk__row${isRevoked || stale ? " is-stale" : ""}`}>
                      <div className="apk__row-name">
                        {k.name}
                        {isRevoked ? (
                          <span
                            className="apk__scope apk__scope--admin"
                            style={{ marginLeft: 8 }}
                            title={`Revoked ${relativeDate(k.revokedAt)}`}
                          >
                            revoked
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="apk__row-prefix"
                        onClick={() => copyText(k.prefix, "Prefix copied")}
                        title="Copy prefix"
                      >
                        <code>{k.prefix}…</code>
                        <Copy />
                      </button>
                      <div className="apk__row-scopes">
                        {k.scopes.map((s) => (
                          <span key={s} className={`apk__scope apk__scope--${s.toLowerCase()}`}>
                            {s.toLowerCase()}
                          </span>
                        ))}
                      </div>
                      <span className="apk__row-last" title={lastUsedTitle}>
                        {relativeDate(k.lastUsedAt)}
                      </span>
                      <span
                        className="apk__row-created"
                        title={`Created ${new Date(k.createdAt).toLocaleString()} by ${initialsOf(k.createdBy)}`}
                      >
                        {new Date(k.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      {isRevoked ? (
                        <span className="apk__row-revoke" title="Key revoked" aria-hidden="true" style={{ opacity: 0.5, cursor: "default" }}>
                          <Ban />
                        </span>
                      ) : (
                        <button type="button" className="apk__row-revoke" onClick={() => revoke(k)} title="Revoke key">
                          <Trash2 />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Create-key modal */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!creating) setCreateOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Generate API key</DialogTitle>
            <DialogDescription>
              Name the key and choose its scopes. You&apos;ll see the secret exactly once.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 pt-1">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-foreground">Name</span>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !creating) void submitCreate(); }}
                placeholder="e.g. Production · Backend"
                maxLength={80}
                className="h-9 rounded-lg border border-border bg-surface px-3 text-[14px] text-foreground outline-none focus:border-[#0073EA] focus:ring-2 focus:ring-[#0073EA]/25"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-foreground">Scopes</span>
              <div className="flex flex-col gap-2">
                {SCOPE_OPTIONS.map((opt) => {
                  const on = newScopes.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleScope(opt.value)}
                      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                        on
                          ? "border-[#0073EA] bg-[#0073EA]/[0.06]"
                          : "border-border bg-surface hover:bg-surface-2"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded border ${
                          on ? "border-[#0073EA] bg-[#0073EA] text-white" : "border-border bg-transparent"
                        }`}
                        aria-hidden="true"
                      >
                        {on ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="flex flex-col">
                        <span className="text-[13.5px] font-medium text-foreground">{opt.label}</span>
                        <span className="text-[12.5px] text-muted">{opt.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {createError ? (
              <div className="flex items-center gap-2 rounded-lg border border-[#E2445C]/30 bg-[#E2445C]/[0.06] px-3 py-2 text-[13px] text-[#E2445C]">
                <AlertTriangle className="h-3.5 w-3.5 flex-none" /> {createError}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
              className="h-9 rounded-lg border border-border bg-surface px-4 text-[14px] font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitCreate()}
              disabled={creating || !newName.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0073EA] px-4 text-[14px] font-semibold text-white hover:bg-[#0060B9] disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Generate key
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reveal-once secret modal */}
      <Dialog open={!!revealed} onOpenChange={(o) => { if (!o) { setRevealed(null); setRevealCopied(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Copy your API key now</DialogTitle>
            <DialogDescription>
              {revealed ? <><strong className="text-foreground">{revealed.name}</strong> is ready. </> : null}
              This is the only time the full secret is shown.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2 rounded-lg border border-[#F5A623]/35 bg-[#F5A623]/[0.08] px-3 py-2.5 text-[13px] text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-[#F5A623]" />
            <span>
              <strong>You won&apos;t be able to see this key again.</strong> Store it in a secret
              manager. If you lose it, revoke this key and generate a new one.
            </span>
          </div>

          <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
            <code className="flex-1 break-all font-mono text-[13.5px] text-foreground">
              {revealed?.plaintext}
            </code>
            <button
              type="button"
              onClick={copyRevealed}
              title="Copy key"
              className={`inline-flex h-8 flex-none items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold ${
                revealCopied
                  ? "bg-[#00A96E]/15 text-[#00A96E]"
                  : "bg-[#0073EA] text-white hover:bg-[#0060B9]"
              }`}
            >
              {revealCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {revealCopied ? "Copied" : "Copy"}
            </button>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => { setRevealed(null); setRevealCopied(false); }}
              className="h-9 rounded-lg bg-[#0073EA] px-4 text-[14px] font-semibold text-white hover:bg-[#0060B9]"
            >
              Done — I&apos;ve saved it
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Key; label: string; value: string; sub: string }) {
  return (
    <div className="apk__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="apk__kpi-accent" aria-hidden="true" />
      <div className="apk__kpi-row">
        <div className="apk__kpi-icon"><Icon /></div>
        <div className="apk__kpi-label">{label}</div>
      </div>
      <div className="apk__kpi-value">{value}</div>
      <div className="apk__kpi-sub">{sub}</div>
    </div>
  );
}
