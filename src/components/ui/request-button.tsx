"use client";

// "Request this" (spec-tools-misc section 3): the one footer control on a
// connector that is not built. A click registers the viewer's demand
// (POST /api/integrations/requests), then the button becomes a count line,
// "Requested · 7 people here want this", with Undo in the toast and a
// Withdraw link that outlives the toast. Never a "Coming soon" control:
// asking is the real action.

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { useOsToast } from "@/components/layout/os/toast";

export function RequestButton({
  connectorKey,
  name,
  count,
  requested,
  onChange,
}: {
  connectorKey: string;
  name: string;
  count: number;
  requested: boolean;
  onChange: (next: { requestCount: number; requestedByMe: boolean }) => void;
}) {
  const { toast } = useOsToast();
  const [busy, setBusy] = useState(false);

  async function undo() {
    const r = await apiFetch<{ requestCount: number; requestedByMe: boolean }>(`/api/integrations/requests?key=${encodeURIComponent(connectorKey)}`, { method: "DELETE" });
    if (r.ok) onChange(r.data);
    else toast("Couldn't undo the request", { tone: "danger" });
  }

  async function ask() {
    setBusy(true);
    const r = await apiFetch<{ requestCount: number; requestedByMe: boolean }>("/api/integrations/requests", { method: "POST", json: { key: connectorKey } });
    setBusy(false);
    if (!r.ok) { toast(r.error || `Couldn't request ${name}`, { tone: "danger" }); return; }
    onChange(r.data);
    toast(`Requested ${name}. Thanks, we read every one of these.`, { action: { label: "Undo", onClick: () => void undo() } });
  }

  if (requested) {
    return (
      <span className="text-sm text-ink-2">
        Requested · {count === 1 ? "1 person here wants this" : `${count} people here want this`}
        {" · "}
        <button
          type="button"
          onClick={async () => { setBusy(true); await undo(); setBusy(false); }}
          disabled={busy}
          className="font-medium text-ink-2 underline-offset-2 hover:text-ink hover:underline disabled:opacity-60"
        >
          Withdraw
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void ask()}
      disabled={busy}
      className="inline-flex h-8 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-60"
    >
      Request this{count > 0 ? <span className="ms-1.5 font-normal text-ink-2">· {count}</span> : null}
    </button>
  );
}
