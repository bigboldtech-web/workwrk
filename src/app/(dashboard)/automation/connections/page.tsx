"use client";

/* /automation/connections: give automations somewhere to send things
 * (spec-ai-automation /automation/connections). Owner and Admin only; the
 * directory layout renders LockedPage for everyone else.
 *
 *   GET    /api/automation/connections                 the Webhook card
 *   POST   /api/automation/connections/WEBHOOK { url } connect or re-point;
 *          the first connect returns the signing secret, once
 *   POST   .../WEBHOOK/test                            one signed sample
 *   POST   .../WEBHOOK/rotate                          a new secret, once
 *   DELETE .../WEBHOOK                                 disconnect
 *
 * The webhook is the one connector automations can use today (the "Send to
 * the webhook" action). Everything else people want lives on /integrations,
 * which every Member can browse and ask on; this page repeats none of it.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { useOsToast } from "@/components/layout/os/toast";
import { StatusChip } from "@/components/ui/chip";
import { useConfirm } from "@/components/ui/dialog-provider";
import { SkeletonCard } from "@/components/ui/skeleton";
import { BTN, CARD, FIELD, InlineRow } from "@/components/automation/automation-ui";
import { apiFetch } from "@/lib/api-fetch";
import { RUN_TONE_COLOR } from "@/lib/automation/run-status";
import { formatDate, formatRelative } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";

interface WebhookRow {
  provider: "WEBHOOK";
  status: "CONNECTED" | "DISCONNECTED" | "EXPIRED" | "ERROR";
  errorMessage: string | null;
  url: string | null;
  secretHint: string | null;
  secretCreatedAt: string | null;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: number | null;
}

const STATUS_VIEW: Record<WebhookRow["status"], { label: string; tone: keyof typeof RUN_TONE_COLOR }> = {
  CONNECTED: { label: "Connected", tone: "success" },
  DISCONNECTED: { label: "Not connected", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "danger" },
  ERROR: { label: "Error", tone: "danger" },
};

export default function AutomationConnectionsPage() {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const [hook, setHook] = useState<WebhookRow | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch<{ connections: WebhookRow[] }>("/api/automation/connections", { cache: "no-store" });
    if (!r.ok) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    const row = r.data.connections.find((c) => c.provider === "WEBHOOK") ?? null;
    setHook(row);
    setUrl(row?.url ?? "");
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const connected = hook?.status === "CONNECTED";
  const dirty = (hook?.url ?? "") !== url.trim() || !connected;

  const save = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setUrlError("Enter the address to send to");
      return;
    }
    setSaving(true);
    setUrlError(null);
    const r = await apiFetch<{ connection: WebhookRow; secret: string | null }>("/api/automation/connections/WEBHOOK", { method: "POST", json: { url: trimmed } });
    setSaving(false);
    if (!r.ok) {
      setUrlError(r.error || "Couldn't save the address");
      toast("Not saved", { tone: "danger" });
      return;
    }
    setHook(r.data.connection);
    setUrl(r.data.connection.url ?? trimmed);
    if (r.data.secret) setSecret(r.data.secret);
    toast(r.data.secret ? "Connected" : "Saved");
  }, [url, toast]);

  const test = useCallback(async () => {
    setTesting(true);
    const r = await apiFetch<{ ok: boolean; httpStatus: number; durationMs: number; message?: string }>("/api/automation/connections/WEBHOOK/test", { method: "POST", json: {} });
    setTesting(false);
    if (!r.ok) {
      toast(r.error || "Couldn't send the test", { tone: "danger" });
      return;
    }
    const d = r.data;
    toast(d.ok ? `Test sent. The address answered ${d.httpStatus} in ${d.durationMs} ms.` : (d.message ?? `The address answered ${d.httpStatus}`), { tone: d.ok ? undefined : "danger" });
    void load();
  }, [load, toast]);

  const rotate = useCallback(async () => {
    const ok = await confirm({
      title: "Rotate the signing secret?",
      description: "Anything using the old secret stops verifying.",
      confirmLabel: "Rotate",
      destructive: true,
    });
    if (!ok) return;
    const r = await apiFetch<{ secret: string }>("/api/automation/connections/WEBHOOK/rotate", { method: "POST", json: {} });
    if (!r.ok) {
      toast(r.error || "Couldn't rotate the secret", { tone: "danger" });
      return;
    }
    setSecret(r.data.secret);
    toast("New secret made");
    void load();
  }, [confirm, load, toast]);

  const disconnect = useCallback(async () => {
    const ok = await confirm({
      title: "Disconnect the webhook?",
      description: "Automations that send to it will start failing.",
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!ok) return;
    const r = await apiFetch("/api/automation/connections/WEBHOOK", { method: "DELETE" });
    if (!r.ok) {
      toast(r.error || "Couldn't disconnect it", { tone: "danger" });
      return;
    }
    setSecret(null);
    toast("Disconnected");
    void load();
  }, [confirm, load, toast]);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast("Couldn't copy. Select the text and copy it yourself.", { tone: "danger" });
    }
  }, [toast]);

  const status = STATUS_VIEW[hook?.status ?? "DISCONNECTED"];

  return (
    <>
      <OsPageHeader title="Connections" />
      <div className="px-6 pb-10 pt-2">
        <div className="os-chrome flex max-w-[560px] flex-col gap-4">
          {loadError ? (
            <InlineRow action={{ label: "Try again", onClick: () => void load() }}>Couldn&apos;t load connections</InlineRow>
          ) : hook === null && !loadError ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : (
            <>
              <section className={`${CARD} overflow-hidden`} aria-labelledby="webhook-title">
                <form
                  className="flex flex-col gap-4 p-5"
                  onSubmit={(e) => { e.preventDefault(); void save(); }}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(); } }}
                >
                  <div className="flex items-center gap-2">
                    <h2 id="webhook-title" className="m-0 text-base font-semibold text-ink">Webhook</h2>
                    <StatusChip disabled color={RUN_TONE_COLOR[status.tone]} label={status.label} />
                  </div>
                  {hook?.errorMessage && (hook.status === "ERROR" || hook.status === "EXPIRED") ? (
                    <p className="m-0 -mt-2 text-sm text-danger-text">{hook.errorMessage}</p>
                  ) : null}

                  <div className="flex flex-col gap-1">
                    <label htmlFor="webhook-url" className="text-sm font-medium text-ink">URL</label>
                    <input
                      id="webhook-url"
                      type="url"
                      inputMode="url"
                      value={url}
                      onChange={(e) => { setUrl(e.target.value); setUrlError(null); }}
                      placeholder="https://"
                      aria-invalid={urlError ? true : undefined}
                      aria-describedby="webhook-url-help"
                      className={FIELD}
                    />
                    {urlError ? (
                      <p className="m-0 text-sm text-danger-text">{urlError}</p>
                    ) : (
                      <p id="webhook-url-help" className="m-0 text-sm text-ink-2">
                        We POST the run&apos;s payload here when an automation uses Send to the webhook.
                      </p>
                    )}
                  </div>

                  {secret ? (
                    <div className="flex flex-col gap-1 rounded-md bg-warning-bg p-3">
                      <span className="text-sm font-medium text-ink">Signing secret</span>
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded bg-raised px-2 py-1 font-mono text-sm text-ink">{secret}</code>
                        <button type="button" onClick={() => void copy(secret)} className={BTN.secondarySm}>
                          <Copy className="size-4" aria-hidden /> Copy
                        </button>
                      </div>
                      <p className="m-0 text-sm text-warning-text">Copy this now. You will not see it again.</p>
                    </div>
                  ) : connected ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-ink">Signing secret</span>
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-subtle px-2.5 py-1.5 font-mono text-sm text-ink-2">
                          whsec_{"•".repeat(16)}{hook?.secretHint ?? ""}
                        </code>
                        <button type="button" onClick={() => void rotate()} className={BTN.danger}>Rotate</button>
                      </div>
                      <p className="m-0 text-sm text-ink-2">
                        Each delivery carries an X-Workwrk-Signature header: an HMAC SHA-256 of the timestamp and the body, made with this secret.
                        {hook?.secretCreatedAt ? ` Made ${formatDate(hook.secretCreatedAt, datePrefs, "date")}.` : ""}
                      </p>
                    </div>
                  ) : null}

                  {/* Only while connected: a delivery from before a disconnect
                      would sit next to "Not connected" and read as a
                      contradiction. */}
                  {connected ? (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink">Last delivery</span>
                    <span className="text-ink-2" title={hook?.lastDeliveryAt ? formatDate(hook.lastDeliveryAt, datePrefs, "datetime") : undefined}>
                      {hook?.lastDeliveryAt
                        ? `${formatRelative(hook.lastDeliveryAt, datePrefs)}${hook.lastDeliveryStatus ? `, answered ${hook.lastDeliveryStatus}` : ", no answer"}`
                        : "No deliveries yet"}
                    </span>
                  </div>
                  ) : hook?.url ? (
                    <p className="m-0 text-sm text-ink-2">Connecting makes a new signing secret. After that, Send a test checks the address answers.</p>
                  ) : null}

                  <div className="flex items-center justify-end gap-2">
                    {connected ? (
                      <button type="button" onClick={() => void test()} disabled={testing || saving} className={BTN.secondary}>
                        {testing ? "Sending" : "Send a test"}
                      </button>
                    ) : null}
                    <button type="submit" disabled={saving || (!dirty && connected)} className={BTN.primary}>
                      {saving ? "Saving" : connected ? "Save" : "Connect"}
                    </button>
                  </div>
                </form>
                {connected ? (
                  <div className="flex items-center justify-between gap-3 border-t border-danger-soft bg-danger-bg/40 px-5 py-3">
                    <p className="m-0 text-sm text-ink-2">Disconnecting stops every delivery. The address is kept so you can reconnect.</p>
                    <button type="button" onClick={() => void disconnect()} className={BTN.danger}>Disconnect</button>
                  </div>
                ) : null}
              </section>

              <section className={`${CARD} p-5`} aria-labelledby="elsewhere-title">
                <h2 id="elsewhere-title" className="m-0 text-base font-semibold text-ink">Somewhere else to send things</h2>
                <p className="m-0 mt-2 text-sm text-ink-2">
                  The webhook is the only connection automations can use today. We build connectors when customers ask for them.
                </p>
                <p className="m-0 mt-1 text-sm text-ink-2">
                  See which ones people here have asked for in{" "}
                  <Link href="/integrations" className={BTN.link}>Integrations</Link>.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
