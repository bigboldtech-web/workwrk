"use client";

// Apps & modules > Google for AI teammates (docs/plans/ai-teammates-phase3.md
// step 2, Decisions 1, 21 and 25): the workspace switch per product, the
// numbers behind it, and Disconnect everyone. Owners and Admins only: GET and
// PUT /api/teammate-connections/policy answer anyone else with the Apps
// page's own refusal, and this section then draws nothing. Counts only:
// nobody's account is ever shown here (Decision 5).
//
// Nothing is drawn when this WorkwrK offers no Google and nobody here is
// connected (`available` false). A product this WorkwrK does not offer yet
// reads as such, its switch off and disabled.
//
// Turning a product off asks first, and offers to disconnect everyone at the
// same time: off stops every use at the next call, but people stay connected
// until they disconnect or an Admin disconnects everyone.

import { useCallback, useEffect, useState } from "react";
import { AccountDialog, btn, Pending } from "@/components/account/account-ui";
import { ConfirmDialog } from "@/components/settings/settings-form";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { Switch } from "@/components/ui/switch";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { CONNECTOR_POLICY_COPY as P } from "@/lib/agents/teammate-copy";
import type { ConnectorPolicyView } from "@/lib/connectors/connection-views";
import { CONNECTOR_PRODUCTS, type ConnectorProduct } from "@/lib/connectors/products";

function productWord(p: ConnectorProduct): string {
  return p === "gmail" ? P.gmail : P.calendar;
}

export function TeammateGoogleSection() {
  const { toast } = useOsToast();
  const [view, setView] = useState<ConnectorPolicyView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "hidden" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<ConnectorProduct | null>(null);
  const [savedAt, setSavedAt] = useState<Partial<Record<ConnectorProduct, number>>>({});
  const [turningOff, setTurningOff] = useState<ConnectorProduct | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch<ConnectorPolicyView>("/api/teammate-connections/policy", { cache: "no-store" });
    if (!r.ok) {
      // Not an Owner or Admin: the section is not theirs to see.
      if (r.status === 403 || r.status === 404) { setState("hidden"); return; }
      setError(r.error);
      setState("error");
      return;
    }
    setView(r.data);
    setState("ready");
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const save = useCallback(async (product: ConnectorProduct, on: boolean): Promise<boolean> => {
    setSavingKey(product);
    const r = await apiFetch<ConnectorPolicyView & { turnedOff: ConnectorProduct[] }>("/api/teammate-connections/policy", { method: "PUT", json: { [product]: on } });
    setSavingKey(null);
    if (!r.ok) { toast(r.error || P.saveFailed, { tone: "danger" }); return false; }
    setView(r.data);
    setSavedAt((s) => ({ ...s, [product]: Date.now() }));
    toast(P.saved);
    return true;
  }, [toast]);

  const disconnectAll = useCallback(async (): Promise<boolean> => {
    const r = await apiFetch<{ disconnected: number }>("/api/teammate-connections/policy/disconnect-all", { method: "POST", json: { confirm: "disconnect" } });
    if (!r.ok) { toast(r.error || P.saveFailed, { tone: "danger" }); return false; }
    toast(P.disconnectedAll(r.data.disconnected));
    void load();
    return true;
  }, [load, toast]);

  if (state === "hidden") return null;
  if (state === "ready" && view && !view.available) return null;

  return (
    <section>
      <h2 className="mb-2 flex items-center gap-3 text-micro font-semibold uppercase tracking-[0.06em] text-ink-2">
        {P.title}<span className="h-px flex-1 bg-line" aria-hidden />
      </h2>
      {/* The anchor the Connections card and the docs link to (/settings/apps#ai-google). */}
      <SettingsCard id="ai-google" title={P.title} description={P.intro}>
        {state === "error" ? (
          <ErrorState compact what={P.errorWhat} hint={error ?? undefined} onRetry={() => { void load(); }} />
        ) : !view ? (
          <SkeletonRows rows={3} />
        ) : (
          <>
            {CONNECTOR_PRODUCTS.map((p) => {
              const offered = view.offered[p];
              return (
                <SettingsRow
                  key={p}
                  label={productWord(p)}
                  helper={offered ? undefined : P.notOffered(productWord(p))}
                  savedAt={savedAt[p] ?? null}
                  control={
                    <Switch
                      checked={view.on[p]}
                      disabled={!offered || savingKey === p}
                      onChange={(next) => {
                        if (next) void save(p, true);
                        else setTurningOff(p);
                      }}
                      aria-label={productWord(p)}
                    />
                  }
                />
              );
            })}
            <p className="text-sm text-ink-2">
              {view.counts.connected === 0
                ? P.noneConnected
                : `${P.counts(view.counts.connected, view.counts.gmail, view.counts.calendar)}${view.counts.needsReconnect > 0 ? ` ${P.needReconnect(view.counts.needsReconnect)}` : ""}`}
            </p>
            {view.counts.connected > 0 ? (
              <div>
                <button type="button" className={btn.dangerGhost} onClick={() => setDisconnectOpen(true)}>
                  {P.disconnectAll}
                </button>
              </div>
            ) : null}
          </>
        )}
      </SettingsCard>

      <AccountDialog
        open={turningOff !== null}
        onOpenChange={(v) => { if (!v && !busy) setTurningOff(null); }}
        title={turningOff ? P.turnOffTitle(productWord(turningOff)) : P.title}
        width={400}
        footer={
          <>
            <button type="button" className={btn.ghost} onClick={() => setTurningOff(null)} disabled={busy}>{P.cancel}</button>
            <button
              type="button"
              className={btn.secondary}
              disabled={busy}
              onClick={async () => {
                if (!turningOff) return;
                setBusy(true);
                const ok = await save(turningOff, false);
                setBusy(false);
                if (ok) setTurningOff(null);
              }}
            >
              {P.turnOff}
            </button>
            <button
              type="button"
              className={btn.danger}
              disabled={busy}
              onClick={async () => {
                if (!turningOff) return;
                setBusy(true);
                const ok = (await save(turningOff, false)) && (await disconnectAll());
                setBusy(false);
                if (ok) setTurningOff(null);
              }}
            >
              {busy ? <Pending /> : null}
              {P.turnOffAndDisconnect}
            </button>
          </>
        }
      >
        <p className="text-base text-ink">{P.turnOffBody}</p>
        {/* Disconnect is the whole grant (Decision 4): turning off one product
            this way ends the other too, so the dialog says so (review of step 2). */}
        <p className="mt-2 text-base text-ink">{P.turnOffDisconnectNote}</p>
      </AccountDialog>

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={(v) => { if (!busy) setDisconnectOpen(v); }}
        title={P.disconnectAllTitle}
        confirmLabel={P.disconnectAll}
        danger
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          const ok = await disconnectAll();
          setBusy(false);
          if (ok) setDisconnectOpen(false);
        }}
      >
        <p>{P.disconnectAllBody}</p>
      </ConfirmDialog>
    </section>
  );
}
