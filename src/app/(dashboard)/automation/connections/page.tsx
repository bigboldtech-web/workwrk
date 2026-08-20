"use client";

/* /automation/connections — integration providers for automation actions.
 *
 *  GET  /api/automation/connections           → the org's connection rows
 *  POST /api/automation/connections/WEBHOOK   → real: upserts a CONNECTED
 *                                               row with the target URL
 *  POST /api/automation/connections/<other>   → 501 today; the card's
 *                                               Connect button surfaces
 *                                               the honest "coming soon"
 *
 * Provider cards show live status from IntegrationConnection. Only
 * admins can connect (API-enforced; errors surface as toasts). There is
 * no disconnect endpoint yet, so no disconnect control is rendered —
 * the webhook card offers "Update" to repoint the URL instead.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  Loader2,
  Mail,
  MessageCircle,
  MessagesSquare,
  Plug,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
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

const PROVIDERS: Array<{
  key: string;
  name: string;
  Icon: LucideIcon;
  description: string;
  isWebhook?: boolean;
}> = [
  {
    key: "WHATSAPP",
    name: "WhatsApp",
    Icon: MessageCircle,
    description: "Message customers and teammates from automation actions.",
  },
  {
    key: "GMAIL",
    name: "Gmail",
    Icon: Mail,
    description: "Send automation emails through your own Gmail account.",
  },
  {
    key: "GOOGLE_CALENDAR",
    name: "Google Calendar",
    Icon: CalendarDays,
    description: "Create and update calendar events from workflows.",
  },
  {
    key: "SLACK",
    name: "Slack",
    Icon: MessagesSquare,
    description: "Post automation messages into Slack channels.",
  },
  {
    key: "WEBHOOK",
    name: "Webhook",
    Icon: Webhook,
    description: "POST trigger payloads to any https endpoint you control.",
    isWebhook: true,
  },
];

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
        className="h-7 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400"
      />
      <button type="button" onClick={() => void connect()} disabled={busy} className={DARK_PILL}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {existingUrl ? "Update" : "Connect"}
      </button>
    </div>
  );
}

export default function AutomationConnectionsPage() {
  const { toast } = useOsToast();
  const [connections, setConnections] = useState<Map<string, ApiConnection> | null>(null);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/automation/connections", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const rows: ApiConnection[] = Array.isArray(data.connections) ? data.connections : [];
      setConnections(new Map(rows.map((c) => [c.provider, c])));
    } catch {
      setConnections(new Map());
      toast("Couldn't load connections");
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Non-webhook providers: the endpoint answers 501 until their OAuth
  // flows ship — surface exactly that instead of a dead button.
  const connectStub = useCallback(
    async (key: string, name: string) => {
      setConnectingKey(key);
      try {
        const res = await fetch(`/api/automation/connections/${key}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 501) {
          toast(`${name} connection is coming soon`);
        } else if (!res.ok) {
          toast(data?.error ?? `Couldn't connect ${name}`);
        } else {
          toast(`${name} connected`);
          void load();
        }
      } catch {
        toast(`Couldn't connect ${name}`);
      } finally {
        setConnectingKey(null);
      }
    },
    [toast, load],
  );

  const connectedCount = connections
    ? [...connections.values()].filter((c) => c.status === "CONNECTED").length
    : 0;

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
        {connections === null ? (
          <div className="flex items-center gap-2 p-6 text-[14px] text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PROVIDERS.map((p) => {
              const row = connections.get(p.key);
              const statusMeta =
                CONNECTION_STATUS_META[row?.status ?? "DISCONNECTED"] ??
                CONNECTION_STATUS_META.DISCONNECTED;
              return (
                <div key={p.key} className={`${CARD} flex flex-col p-4`}>
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-zinc-100 bg-zinc-50">
                      <p.Icon className="h-4.5 w-4.5 text-zinc-600" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold text-zinc-900">{p.name}</div>
                      <StatusPill color={statusMeta.color} label={statusMeta.label} />
                    </div>
                  </div>
                  <p className="mt-2.5 flex-1 text-[13px] leading-relaxed text-zinc-500">
                    {p.description}
                  </p>
                  {row?.errorMessage ? (
                    <p className="mt-1.5 text-[12.5px] text-[#E2445C]">{row.errorMessage}</p>
                  ) : null}
                  {row?.lastSyncAt ? (
                    <p className="mt-1.5 text-[12px] text-zinc-400">
                      Last synced {relTime(row.lastSyncAt)}
                    </p>
                  ) : null}
                  {p.isWebhook ? (
                    <WebhookForm connection={row} onConnected={() => void load()} />
                  ) : (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => void connectStub(p.key, p.name)}
                        disabled={connectingKey === p.key}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-[13.5px] font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        {connectingKey === p.key ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        Connect
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
