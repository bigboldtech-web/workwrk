"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Check, Plus, Trash2, AlertTriangle, Key, Webhook } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { useConfirm } from "@/components/ui/dialog-provider";

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: ("READ" | "WRITE" | "ADMIN")[];
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  lastUsedAt: string | null;
  requestCount: number;
  revokedAt: string | null;
  createdAt: string;
  createdBy?: { firstName: string; lastName: string } | null;
};

type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  status: string;
  secretPrefix: string;
  failureCount: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  _count?: { deliveries: number };
};

export default function ApiSettingsPage() {
  const confirm = useConfirm();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [subs, setSubs] = useState<WebhookRow[]>([]);
  const [validEvents, setValidEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyPlain, setNewKeyPlain] = useState<string | null>(null);
  const [newSecretPlain, setNewSecretPlain] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Create-key form
  const [creatingKey, setCreatingKey] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyScopes, setKeyScopes] = useState<Set<string>>(new Set(["READ"]));

  // Create-webhook form
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [whUrl, setWhUrl] = useState("");
  const [whEvents, setWhEvents] = useState<Set<string>>(new Set(["*"]));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [kRes, wRes] = await Promise.all([
        fetch("/api/keys").then((r) => (r.ok ? r.json() : { data: [] })),
        fetch("/api/webhooks").then((r) => (r.ok ? r.json() : { data: [], validEvents: [] })),
      ]);
      setKeys(kRes.data ?? []);
      setSubs(wRes.data ?? []);
      setValidEvents(wRes.validEvents ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    setCreatingKey(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: keyName,
          scopes: Array.from(keyScopes),
        }),
      });
      const data = await res.json();
      if (res.ok && data.plaintext) {
        setNewKeyPlain(data.plaintext);
        setKeyName("");
        setKeyScopes(new Set(["READ"]));
        refresh();
      }
    } finally {
      setCreatingKey(false);
    }
  }

  async function revokeKey(id: string) {
    if (!(await confirm({
      title: "Revoke this API key?",
      description: "Clients using it will start getting 401 responses immediately. This cannot be undone.",
      confirmLabel: "Revoke key",
      destructive: true,
    }))) return;
    await fetch(`/api/keys?id=${id}`, { method: "DELETE" });
    refresh();
  }

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!whUrl.trim()) return;
    setCreatingWebhook(true);
    try {
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: whUrl,
          events: Array.from(whEvents),
        }),
      });
      const data = await res.json();
      if (res.ok && data.secret) {
        setNewSecretPlain(data.secret);
        setWhUrl("");
        setWhEvents(new Set(["*"]));
        refresh();
      }
    } finally {
      setCreatingWebhook(false);
    }
  }

  async function deleteWebhook(id: string) {
    if (!(await confirm({
      title: "Delete this webhook?",
      description: "Delivery history will be removed too. The remote endpoint won't get any further events.",
      confirmLabel: "Delete webhook",
      destructive: true,
    }))) return;
    await fetch(`/api/webhooks?id=${id}`, { method: "DELETE" });
    refresh();
  }

  function copyToClipboard(text: string, marker: string) {
    navigator.clipboard.writeText(text);
    setCopied(marker);
    setTimeout(() => setCopied(null), 1800);
  }

  function toggleScope(scope: string) {
    setKeyScopes((prev) => {
      const next = new Set(prev);
      next.has(scope) ? next.delete(scope) : next.add(scope);
      if (next.size === 0) next.add("READ");
      return next;
    });
  }

  function toggleEvent(evt: string) {
    setWhEvents((prev) => {
      const next = new Set(prev);
      if (evt === "*") {
        if (next.has("*")) next.delete("*");
        else {
          next.clear();
          next.add("*");
        }
      } else {
        next.delete("*");
        next.has(evt) ? next.delete(evt) : next.add(evt);
        if (next.size === 0) next.add("*");
      }
      return next;
    });
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        kicker="API · Developer access"
        title="API keys + webhooks"
        subtitle="Generate keys to authenticate REST calls, register webhook URLs to receive live events. Full reference at /developers."
      />

      {/* One-time secret reveal banners */}
      {newKeyPlain && (
        <OneTimeReveal
          heading="Copy your new API key now"
          body="This is the ONLY time we'll show it. Store it in your secrets manager."
          secret={newKeyPlain}
          marker="newkey"
          copied={copied}
          onCopy={copyToClipboard}
          onDismiss={() => setNewKeyPlain(null)}
        />
      )}
      {newSecretPlain && (
        <OneTimeReveal
          heading="Copy your webhook signing secret now"
          body="Use this to verify the X-Workwrk-Signature header on every delivery."
          secret={newSecretPlain}
          marker="newsecret"
          copied={copied}
          onCopy={copyToClipboard}
          onDismiss={() => setNewSecretPlain(null)}
        />
      )}

      {/* ============ API KEYS ============ */}
      <section className="api-sect">
        <div className="api-sect-head">
          <div>
            <h2 className="api-sect-title">
              <Key size={16} /> API keys
            </h2>
            <p className="api-sect-sub">Rate-limited by default. Rotate often.</p>
          </div>
        </div>

        <form onSubmit={createKey} className="api-form">
          <input
            type="text"
            className="api-input"
            placeholder="Key name (e.g. 'Production · Backend')"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            maxLength={80}
          />
          <div className="api-scope-row">
            {(["READ", "WRITE", "ADMIN"] as const).map((s) => (
              <button
                type="button"
                key={s}
                className={`api-scope${keyScopes.has(s) ? " is-active" : ""}`}
                onClick={() => toggleScope(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <button type="submit" className="api-cta" disabled={creatingKey || !keyName.trim()}>
            <Plus size={14} /> {creatingKey ? "Creating…" : "Create key"}
          </button>
        </form>

        <div className="api-list">
          {loading && <div className="api-empty">Loading…</div>}
          {!loading && keys.length === 0 && (
            <div className="api-empty">No keys yet. Create one above to start calling the API.</div>
          )}
          {keys.map((k) => (
            <div key={k.id} className={`api-row ${k.revokedAt ? "is-revoked" : ""}`}>
              <div className="api-row-head">
                <div>
                  <div className="api-row-name">{k.name}</div>
                  <code className="api-row-prefix">{k.prefix}…</code>
                </div>
                <div className="api-row-meta">
                  {k.scopes.map((s) => (
                    <span key={s} className={`api-chip api-chip-${s.toLowerCase()}`}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div className="api-row-foot">
                <span>
                  {k.requestCount.toLocaleString()} reqs ·{" "}
                  {k.rateLimitPerMinute}/min · {k.rateLimitPerDay.toLocaleString()}/day
                </span>
                <span>
                  {k.lastUsedAt ? `last used ${timeAgo(k.lastUsedAt)}` : "never used"}
                </span>
                {k.revokedAt ? (
                  <span className="api-revoked">REVOKED</span>
                ) : (
                  <button className="api-delete" onClick={() => revokeKey(k.id)}>
                    <Trash2 size={12} /> Revoke
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ============ WEBHOOKS ============ */}
      <section className="api-sect">
        <div className="api-sect-head">
          <div>
            <h2 className="api-sect-title">
              <Webhook size={16} /> Webhook subscriptions
            </h2>
            <p className="api-sect-sub">
              HMAC-SHA256 signed. Automatic retries with exponential backoff up to 8 attempts.
            </p>
          </div>
        </div>

        <form onSubmit={createWebhook} className="api-form">
          <input
            type="url"
            className="api-input"
            placeholder="https://your-app.example.com/workwrk-events"
            value={whUrl}
            onChange={(e) => setWhUrl(e.target.value)}
          />
          <div className="api-evt-row">
            {validEvents.length === 0 ? (
              <span className="api-evt-empty">Events loading…</span>
            ) : (
              validEvents.map((e) => (
                <button
                  type="button"
                  key={e}
                  className={`api-evt${whEvents.has(e) ? " is-active" : ""}`}
                  onClick={() => toggleEvent(e)}
                >
                  {e}
                </button>
              ))
            )}
          </div>
          <button type="submit" className="api-cta" disabled={creatingWebhook || !whUrl.trim()}>
            <Plus size={14} /> {creatingWebhook ? "Creating…" : "Register webhook"}
          </button>
        </form>

        <div className="api-list">
          {loading && <div className="api-empty">Loading…</div>}
          {!loading && subs.length === 0 && (
            <div className="api-empty">No webhook subscriptions yet.</div>
          )}
          {subs.map((w) => (
            <div key={w.id} className={`api-row ${w.status !== "ACTIVE" ? "is-paused" : ""}`}>
              <div className="api-row-head">
                <div>
                  <code className="api-row-name api-url">{w.url}</code>
                  <div className="api-row-prefix">
                    {w.events.map((e) => (
                      <span key={e} className="api-chip-mini">{e}</span>
                    ))}
                  </div>
                </div>
                <span
                  className={`api-chip api-chip-${
                    w.status === "ACTIVE" ? "read" : w.status === "PAUSED" ? "write" : "admin"
                  }`}
                >
                  {w.status}
                </span>
              </div>
              <div className="api-row-foot">
                <span>
                  {w._count?.deliveries ?? 0} deliveries ·{" "}
                  {w.failureCount > 0 ? `${w.failureCount} recent fails` : "healthy"}
                </span>
                <span>
                  {w.lastSuccessAt
                    ? `last ok ${timeAgo(w.lastSuccessAt)}`
                    : w.lastFailureAt
                    ? `last fail ${timeAgo(w.lastFailureAt)}`
                    : "no deliveries yet"}
                </span>
                <button className="api-delete" onClick={() => deleteWebhook(w.id)}>
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <style>{`
        .api-sect {
          background: #141414;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 24px;
        }
        .api-sect-head { margin-bottom: 20px; }
        .api-sect-title {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-size: 15px !important;
          font-weight: 600;
          color: #fafafa;
          margin: 0;
          letter-spacing: -0.01em;
        }
        .api-sect-sub { font-size: 12.5px; color: #a0a0a0; margin: 4px 0 0; }
        .api-form {
          display: flex; flex-direction: column; gap: 10px;
          padding: 16px;
          background: #0a0a0a;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          margin-bottom: 16px;
        }
        .api-input {
          width: 100%;
          padding: 10px 14px;
          background: #1a1a1a;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          color: #fafafa;
          font-size: 13.5px;
          font-family: inherit;
        }
        .api-input:focus {
          outline: none;
          border-color: #d4ff2e;
          box-shadow: 0 0 0 3px rgba(212,255,46,0.12);
        }
        .api-scope-row, .api-evt-row {
          display: flex; flex-wrap: wrap; gap: 6px;
        }
        .api-scope, .api-evt {
          padding: 5px 10px;
          background: transparent;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 100px;
          color: #a0a0a0;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.08em;
          cursor: pointer;
          transition: all 0.2s;
        }
        .api-scope:hover, .api-evt:hover { color: #fafafa; border-color: rgba(255,255,255,0.14); }
        .api-scope.is-active, .api-evt.is-active {
          background: rgba(212,255,46,0.1);
          color: #d4ff2e;
          border-color: rgba(212,255,46,0.35);
        }
        .api-evt-empty {
          font-size: 11px;
          color: #707070;
          font-style: italic;
        }
        .api-cta {
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          background: #d4ff2e;
          color: #0a0a0a;
          border: 0;
          border-radius: 100px;
          font-family: inherit;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
        }
        .api-cta:disabled { opacity: 0.55; cursor: not-allowed; }
        .api-list {
          display: flex; flex-direction: column;
          gap: 8px;
        }
        .api-empty {
          padding: 28px 16px;
          text-align: center;
          font-size: 13px;
          color: #707070;
          border: 1px dashed rgba(255,255,255,0.08);
          border-radius: 12px;
        }
        .api-row {
          background: #1a1a1a;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          padding: 14px 16px;
        }
        .api-row.is-revoked,
        .api-row.is-paused { opacity: 0.55; }
        .api-row-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 8px;
        }
        .api-row-name {
          font-size: 14px;
          font-weight: 600;
          color: #fafafa;
        }
        .api-url {
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px !important;
          word-break: break-all;
        }
        .api-row-prefix {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: #707070;
          display: inline-flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 4px;
        }
        .api-chip-mini {
          font-size: 9.5px;
          padding: 2px 7px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 100px;
          color: #a0a0a0;
          letter-spacing: 0.04em;
        }
        .api-row-meta {
          display: inline-flex; gap: 5px;
          flex-wrap: wrap;
        }
        .api-chip {
          padding: 2px 9px;
          border-radius: 100px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 10px;
          letter-spacing: 0.14em;
          border: 1px solid currentColor;
          background: rgba(255,255,255,0.02);
        }
        .api-chip-read { color: #4a9eff; }
        .api-chip-write { color: #d4ff2e; }
        .api-chip-admin { color: #ff3d8a; }
        .api-row-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding-top: 10px;
          border-top: 1px dashed rgba(255,255,255,0.06);
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          color: #707070;
          letter-spacing: 0.04em;
          flex-wrap: wrap;
        }
        .api-delete {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          background: transparent;
          border: 1px solid rgba(255,61,138,0.25);
          color: #ff3d8a;
          border-radius: 100px;
          font-family: inherit;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
        }
        .api-delete:hover { background: rgba(255,61,138,0.08); }
        .api-revoked {
          color: #ff3d8a;
          font-weight: 700;
          letter-spacing: 0.14em;
        }
      `}</style>
    </div>
  );
}

function OneTimeReveal({
  heading,
  body,
  secret,
  marker,
  copied,
  onCopy,
  onDismiss,
}: {
  heading: string;
  body: string;
  secret: string;
  marker: string;
  copied: string | null;
  onCopy: (text: string, marker: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        background: "rgba(212, 255, 46, 0.06)",
        border: "1px solid rgba(212, 255, 46, 0.35)",
        borderRadius: 16,
        padding: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <AlertTriangle size={16} style={{ color: "var(--b-accent-text)" }} />
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--b-accent-text)",
            letterSpacing: "-0.01em",
          }}
        >
          {heading}
        </span>
      </div>
      <p style={{ fontSize: 13, color: "var(--b-t2)", margin: "0 0 12px", lineHeight: 1.5 }}>
        {body}
      </p>
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          padding: "12px 14px",
          background: "var(--b-bg)",
          border: "1px solid var(--b-line)",
          borderRadius: 10,
        }}
      >
        <code
          style={{
            flex: 1,
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 12.5,
            color: "var(--b-fg)",
            wordBreak: "break-all",
          }}
        >
          {secret}
        </code>
        <button
          type="button"
          onClick={() => onCopy(secret, marker)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            background: "#d4ff2e",
            color: "#0a0a0a",
            border: 0,
            borderRadius: 100,
            fontFamily: "inherit",
            fontSize: 11.5,
            fontWeight: 600,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {copied === marker ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          marginTop: 12,
          padding: "4px 12px",
          background: "transparent",
          border: "1px solid var(--b-line)",
          color: "var(--b-t2)",
          borderRadius: 100,
          fontFamily: "inherit",
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        I've saved it — dismiss
      </button>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
