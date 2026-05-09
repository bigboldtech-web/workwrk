"use client";

// Identity & SSO admin page. Two cards:
//   1. SAML configuration — issuer / SSO URL / x509 cert / attribute
//      mapping. Toggle to enable. Real cryptographic verification
//      lands once `samlify` is installed; the form stores the config
//      either way.
//   2. SCIM tokens — mint / list / revoke bearer tokens used by IdPs
//      to provision users. Token shown ONCE on creation.

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ShieldCheck, KeyRound, Plus, Copy, Trash2 } from "lucide-react";

type IdP = {
  id: string;
  type: "SAML" | "OIDC";
  enabled: boolean;
  issuer: string | null;
  ssoUrl: string | null;
  sloUrl: string | null;
  certificate: string | null;
  jitProvision: boolean;
  attributeMap: Record<string, string>;
};

type ScimToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export default function IdentityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck size={20} /> Identity & SSO
        </h1>
        <p className="text-muted text-sm mt-1 max-w-prose">
          Single sign-on via SAML and automated user provisioning via
          SCIM 2.0. Plug in your IdP (Okta, Azure AD, OneLogin, Google
          Workspace) once and IT manages employees from there.
        </p>
      </div>

      <SamlCard />
      <ScimCard />
    </div>
  );
}

// ─── SAML card ─────────────────────────────────────────────────────

function SamlCard() {
  const { toast } = useToast();
  const [idp, setIdp] = useState<IdP | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issuer, setIssuer] = useState("");
  const [ssoUrl, setSsoUrl] = useState("");
  const [sloUrl, setSloUrl] = useState("");
  const [certificate, setCertificate] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [jitProvision, setJitProvision] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/identity-providers");
      const data = await res.json();
      const saml = Array.isArray(data) ? data.find((p) => p.type === "SAML") : null;
      setIdp(saml ?? null);
      setIssuer(saml?.issuer ?? "");
      setSsoUrl(saml?.ssoUrl ?? "");
      setSloUrl(saml?.sloUrl ?? "");
      setCertificate(saml?.certificate ?? "");
      setEnabled(saml?.enabled ?? false);
      setJitProvision(saml?.jitProvision ?? true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/identity-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "SAML",
          issuer: issuer.trim() || null,
          ssoUrl: ssoUrl.trim() || null,
          sloUrl: sloUrl.trim() || null,
          certificate: certificate.trim() || null,
          enabled,
          jitProvision,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't save", description: data?.error });
        return;
      }
      toast({ type: "success", title: "SAML configuration saved" });
      load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck size={16} /> SAML 2.0
          </CardTitle>
          <Badge variant="outline" className={`text-[10px] ${enabled ? "text-green-400 border-green-400/30" : "text-muted border-white/20"}`}>
            {enabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>
        <p className="text-xs text-muted mt-1">
          The IdP signs assertions with this certificate; we verify and
          create or match a User on each login.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Issuer (Entity ID)</Label>
              <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://idp.example.com/saml" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>SSO URL</Label>
                <Input value={ssoUrl} onChange={(e) => setSsoUrl(e.target.value)} placeholder="https://idp.example.com/sso" />
              </div>
              <div className="space-y-1.5">
                <Label>SLO URL (optional)</Label>
                <Input value={sloUrl} onChange={(e) => setSloUrl(e.target.value)} placeholder="https://idp.example.com/slo" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>x509 certificate (PEM)</Label>
              <Textarea
                value={certificate}
                onChange={(e) => setCertificate(e.target.value)}
                rows={5}
                placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----"
                className="font-mono text-xs"
              />
            </div>

            <div className="flex items-center gap-3 text-sm">
              <input
                id="enabled"
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <label htmlFor="enabled">Enable SAML login</label>
              <span className="text-[10px] text-muted ml-auto">
                Requires issuer + SSO URL + certificate to enable.
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <input
                id="jit"
                type="checkbox"
                checked={jitProvision}
                onChange={(e) => setJitProvision(e.target.checked)}
              />
              <label htmlFor="jit">Just-in-time provision new users</label>
              <span className="text-[10px] text-muted ml-auto">
                Disable if SCIM is already creating accounts.
              </span>
            </div>

            <div className="rounded-md border border-amber-400/30 bg-amber-400/5 p-3 text-xs space-y-1">
              <p className="font-medium text-amber-400">Cryptographic verification pending package install.</p>
              <p className="text-muted">
                The form stores config now. Once `samlify` (or equivalent
                SAML-validation library) is installed and wired into the
                login route, real assertion verification activates.
                Until then this row is ignored at login.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <Button disabled={saving} onClick={save}>
                {saving ? "Saving…" : idp ? "Save changes" : "Save SAML config"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── SCIM card ─────────────────────────────────────────────────────

function ScimCard() {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<ScimToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; token: string } | null>(null);
  const scimBase = typeof window !== "undefined" ? `${window.location.origin}/api/scim/v2` : "/api/scim/v2";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/scim-tokens");
      const data = await res.json();
      setTokens(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function revoke(id: string, name: string) {
    if (!confirm(`Revoke "${name}"? Any IdP using it will lose access immediately.`)) return;
    const res = await fetch(`/api/scim-tokens/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revoke: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ type: "error", title: "Couldn't revoke", description: data?.error });
      return;
    }
    toast({ type: "success", title: "Token revoked" });
    load();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound size={16} /> SCIM 2.0 tokens
          </CardTitle>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={12} className="mr-1.5" /> Mint token
          </Button>
        </div>
        <p className="text-xs text-muted mt-1">
          Paste a token into your IdP's WorkWrk SCIM connector. Base URL:
          <code className="ml-1 text-[color:var(--accent-strong)] font-mono">{scimBase}</code>
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="text-xs text-muted p-4">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="text-xs text-muted p-6 text-center">No tokens yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-white/5">
                <th className="px-4 py-2.5 font-normal">Name</th>
                <th className="px-4 py-2.5 font-normal">Prefix</th>
                <th className="px-4 py-2.5 font-normal">Last used</th>
                <th className="px-4 py-2.5 font-normal">State</th>
                <th className="px-4 py-2.5 font-normal text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-b border-white/5">
                  <td className="px-4 py-2.5">{t.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted">{t.tokenPrefix}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">
                    {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}
                  </td>
                  <td className="px-4 py-2.5">
                    {t.revokedAt ? (
                      <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">Revoked</Badge>
                    ) : t.expiresAt && new Date(t.expiresAt) < new Date() ? (
                      <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">Expired</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-green-400 border-green-400/30">Active</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {!t.revokedAt && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-red-400"
                        onClick={() => revoke(t.id, t.name)}
                      >
                        <Trash2 size={11} className="mr-1" /> Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>

      {creating && (
        <CreateTokenDialog
          onClose={() => setCreating(false)}
          onCreated={(name, token) => {
            setCreating(false);
            setRevealed({ name, token });
            load();
          }}
        />
      )}
      {revealed && (
        <RevealTokenDialog reveal={revealed} onClose={() => setRevealed(null)} />
      )}
    </Card>
  );
}

function CreateTokenDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string, token: string) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const expiresAt = expiresInDays
        ? new Date(Date.now() + Number(expiresInDays) * 24 * 3600 * 1000).toISOString()
        : null;
      const res = await fetch("/api/scim-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), expiresAt }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't mint", description: data?.error });
        return;
      }
      onCreated(data.name, data.token);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Mint SCIM token</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Okta production"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Expires in (days, optional)</Label>
            <Input
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              inputMode="numeric"
              placeholder="365"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!name.trim() || saving} onClick={save}>
            {saving ? "Minting…" : "Mint"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevealTokenDialog({
  reveal,
  onClose,
}: {
  reveal: { name: string; token: string };
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reveal.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ type: "error", title: "Couldn't copy" });
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Token for "{reveal.name}"</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="rounded-md border border-amber-400/30 bg-amber-400/5 p-3 text-xs">
            <p className="font-medium text-amber-400">Copy now — this token will never be shown again.</p>
            <p className="text-muted mt-1">
              Paste it into your IdP's SCIM connector configuration along with the base URL above.
            </p>
          </div>
          <div className="rounded-md border border-white/10 bg-card-2/30 p-3">
            <code className="text-xs font-mono break-all">{reveal.token}</code>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={copy}>
            <Copy size={12} className="mr-1.5" /> {copied ? "Copied!" : "Copy"}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
