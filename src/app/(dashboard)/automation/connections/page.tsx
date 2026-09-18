"use client";

/* /automation/connections: the org's automation connections. Owner and
 * Admin only; the directory layout renders LockedPage for everyone else.
 *
 *  GET  /api/automation/connections           the org's connection rows
 *  POST /api/automation/connections/WEBHOOK   upserts a CONNECTED row with
 *                                             the target URL
 *
 * One provider card today: Webhook, the only connection the API can make.
 * The four provider cards this page used to fake (WhatsApp, Gmail, Google
 * Calendar, Slack) are gone (naming-canon 2.13); they live on /integrations
 * as "Request this" cards. There is no disconnect endpoint yet, so no
 * disconnect control is rendered; the card offers "Update" to repoint the
 * URL instead. A failed read is the error primitive with Try again, never
 * an empty grid (spec-shell 1.7).
 */

import { useCallback, useEffect, useState } from "react";
import { Plug, Webhook } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { Dots } from "@/components/ui/dots";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { AutomationHeader, CARD, DARK_PILL, StatusPill, relTime } from "../shared";

interface ApiConnection {
  id: string;
  provider: string;
  status: string;
  metadataJson: unknown;
  lastSyncAt: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

const CONNECTION_STATUS_META: Record<string, { label: string; color: string }> = {
  CONNECTED: { label: "Connected", color: "#00C875" },
  DISCONNECTED: { label: "Not connected", color: "#A1A1AA" },
  EXPIRED: { label: "Expired", color: "#F59E0B" },
  ERROR: { label: "Error", color: "#E2445C" },
};

function WebhookForm({
  connection,
  onConnected,
}: {
  connection: ApiConnection | undefined;
  onConnected: () => void;
}) {
  const { toast } = useOsToast();
  const existingUrl =
    connection?.metadataJson &&
    typeof connection.metadataJson === "object" &&
    typeof (connection.metadataJson as Record<string, unknown>).url === "string"
      ? ((connection.metadataJson as Record<string, unknown>).url as string)
      : "";
  const [url, setUrl] = useState(existingUrl);
  const [busy, setBusy] = useState(false);

  // Keep the input in sync when the connection row loads after mount.
  useEffect(() => {
    setUrl(existingUrl);
  }, [existingUrl]);

  const connect = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      toast("Enter the webhook URL first");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/automation/connections/WEBHOOK", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? "Couldn't connect the webhook");
        return;
      }
      toast(existingUrl ? "Webhook updated" : "Webhook connected");
      onConnected();
    } catch {
      toast("Couldn't connect the webhook");
    } finally {
      setBusy(false);
    }
  }, [url, existingUrl, toast, onConnected]);

  return (
    <div className="mt-3 flex items-center gap-2">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com/hooks/workwrk"
        aria-label="Webhook URL"
        className="h-7 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400"
      />
      <button type="button" onClick={() => void connect()} disabled={busy} className={DARK_PILL}>
        {busy ? <Dots variant="pending" label="Connecting" /> : null}
        {existingUrl ? "Update" : "Connect"}
      </button>
    </div>
  );
}

export default function AutomationConnectionsPage() {
  const [connections, setConnections] = useState<Map<string, ApiConnection> | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/automation/connections", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rows: ApiConnection[] = Array.isArray(data.connections) ? data.connections : [];
      setConnections(new Map(rows.map((c) => [c.provider, c])));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connectedCount = connections
    ? [...connections.values()].filter((c) => c.status === "CONNECTED").length
    : 0;
  const webhook = connections?.get("WEBHOOK");
  const statusMeta =
    CONNECTION_STATUS_META[webhook?.status ?? "DISCONNECTED"] ?? CONNECTION_STATUS_META.DISCONNECTED;

  return (
    <div className="flex h-full flex-col bg-white">
      <AutomationHeader
        Icon={Plug}
        title="Connections"
        meta={
          connections !== null ? (
            <span className="tabular-nums">{connectedCount} connected</span>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-4">
        {loadError ? (
          <ErrorState what="connections" onRetry={() => { setLoadError(false); void load(); }} />
        ) : connections === null ? (
          <SkeletonRows rows={3} />
        ) : (
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className={`${CARD} flex flex-col p-4`}>
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-zinc-100 bg-zinc-50">
                  <Webhook className="h-4.5 w-4.5 text-zinc-600" />
                </span>
                <div className="min-w-0">
                  <div className="text-base font-semibold text-zinc-900">Webhook</div>
                  <StatusPill color={statusMeta.color} label={statusMeta.label} />
                </div>
              </div>
              <p className="mt-2.5 flex-1 text-sm leading-relaxed text-zinc-500">
                POST trigger payloads to any https endpoint you control.
              </p>
              {webhook?.errorMessage ? (
                <p className="mt-1.5 text-xs text-[#E2445C]">{webhook.errorMessage}</p>
              ) : null}
              {webhook?.lastSyncAt ? (
                <p className="mt-1.5 text-xs text-zinc-400">
                  Last synced {relTime(webhook.lastSyncAt)}
                </p>
              ) : null}
              <WebhookForm connection={webhook} onConnected={() => void load()} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
