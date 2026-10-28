"use client";

/* My settings · Calendar & connections · AI apps (docs/plans/mcp-server.md
 * 6.2, 3.9, Decision 10).
 *
 * The AI apps the person connected to WorkwrK through the MCP server, one
 * row per live connection, in every workspace they belong to: the app's
 * label (with a capital first letter) and "Not checked by WorkwrK"; where
 * it works and what it may do; when it was connected and last used; how
 * many changes it made, with Show changes (its audit rows, newest first,
 * each linking to the task or doc it changed); and Disconnect, which asks
 * first and ends it at once. GET /api/me/connected-apps puts each grant
 * through the bearer check's standing first, so a connection that no longer
 * stands is revoked and never drawn. Read again when the tab comes back, as
 * the page does.
 *
 * NOTHING IS DRAWN until the first answer, and nothing at all while this
 * WorkwrK does not offer the MCP server (the routes answer 404 while
 * MCP_OFFERED is unset), the precedent of Apps & modules' sections: no
 * loading line or error flashes in production. Once an answer was drawn, a
 * failed read again shows the error with Try again.
 *
 * The accepted risk (Decision 10) is said here, as the privacy policy says
 * it: logging out of one browser keeps the apps connected.
 *
 * Anchored #ai-apps: the Inbox notices of a new connection and of one
 * disconnected for safety link here, and the card lands on its anchor once
 * its read is back (SettingsCard's own landing). No blue button: this page's
 * one is Connect Google Calendar (design-system 4.4). Every sentence comes
 * from src/lib/mcp/mcp-copy.ts.
 *
 * DRAWN FROM THE SHARED PARTS (settings-cleanup Phase 3, B4 to B6): one
 * SettingsCard, one SettingsRow per app (its name and the Not checked chip,
 * where it works as the hint, Disconnect as the control, its dates and
 * changes as the row's detail lines). With none connected, the how-to steps
 * are behind Show more; the logout note is a consequence, so it stays in
 * sight.
 *
 * NO WORKSPACE IS PINNED here, unlike Settings' AI apps section (review of
 * step 4, L3): the list is the person's own, in every workspace they belong
 * to, and Disconnect names a connection of theirs by its id, so a session
 * switched to another workspace in another tab reads the same list and
 * acts on the same connections.
 *
 * useAiAppsOffered is the same read, for a page that only needs to know
 * whether this WorkwrK offers AI apps (the Security page's Log out
 * everywhere, docs/plans/mcp-server.md 11.2): true only on a 200, so a page
 * never names a feature that is not offered.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/settings/settings-form";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { SettingsMore } from "@/components/settings/settings-more";
import { btn, OutcomeLine, TAG } from "@/components/account/account-ui";
import { Dots } from "@/components/ui/dots";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { MCP_CONNECTED_COPY as C, MCP_TOOL_COPY } from "@/lib/mcp/mcp-copy";
import type { ConnectedApp, ConnectedAppChange } from "@/lib/mcp/connected-apps";

const ROUTE = "/api/me/connected-apps";
const ANCHOR = "ai-apps";

type ConnectedAppsView = { apps: ConnectedApp[]; address: string; docsUrl: string | null };
type Changes = { state: "loading" } | { state: "error" } | { state: "ready"; changes: ConnectedAppChange[]; more: boolean };

/** "an app on this computer" reads "An app on this computer" at the head of its row. */
function capitalFirst(label: string): string {
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

/** Whether this WorkwrK offers AI apps (MCP) here: the connected-apps route answers 200 only then. False until it answers, and on any failure. */
export function useAiAppsOffered(): boolean {
  const [offered, setOffered] = useState(false);
  useEffect(() => {
    let live = true;
    void apiFetch<ConnectedAppsView>(ROUTE, { cache: "no-store" }).then((r) => {
      if (live) setOffered(r.ok);
    });
    return () => {
      live = false;
    };
  }, []);
  return offered;
}

export function ConnectedAppsCard() {
  const { toast } = useOsToast();
  const fmt = useFormat();
  const [view, setView] = useState<ConnectedAppsView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "hidden" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, Changes>>({});
  const [confirm, setConfirm] = useState<ConnectedApp | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch<ConnectedAppsView>(ROUTE, { cache: "no-store" });
    if (!r.ok) {
      // Not offered here: the card is not drawn.
      if (r.status === 404) { setState("hidden"); return; }
      setLoadError(r.error);
      setState("error");
      return;
    }
    setLoadError(null);
    setView(r.data);
    setState("ready");
  }, []);

  useEffect(() => {
    const run = async () => { await load(); };
    void run();
  }, [load]);

  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Arriving at #ai-apps (an Inbox notice): the card is drawn only once its
  // read is back, and SettingsCard lands on its own id when it mounts: it
  // scrolls in (at once for anyone who asked for less motion), pulses once
  // and stays in place while the cards above it load (landOnHash).

  /** Show changes: the connection's own audit rows, read when asked; Hide changes forgets them. */
  const toggleChanges = useCallback(async (id: string) => {
    if (changes[id]) {
      setChanges((c) => {
        const next = { ...c };
        delete next[id];
        return next;
      });
      return;
    }
    setChanges((c) => ({ ...c, [id]: { state: "loading" } }));
    const r = await apiFetch<{ changes: ConnectedAppChange[]; more: boolean }>(`${ROUTE}/${encodeURIComponent(id)}/activity`, { cache: "no-store" });
    setChanges((c) => ({ ...c, [id]: r.ok ? { state: "ready", changes: r.data.changes, more: r.data.more } : { state: "error" } }));
  }, [changes]);

  async function disconnect(app: ConnectedApp) {
    setBusy(true);
    const url = `${ROUTE}/${encodeURIComponent(app.id)}`;
    const r = await apiFetch<{ disconnected: boolean }>(url, { method: "DELETE" });
    setBusy(false);
    setConfirm(null);
    if (!r.ok) {
      // Already ended elsewhere (404): the list is read again and says so by its absence.
      toast(r.error || C.disconnectFailed, { tone: "danger" });
      void load();
      return;
    }
    toast(C.disconnectedToast(capitalFirst(app.app)));
    void load();
  }

  // Nothing while it loads, nothing where the MCP server is not offered, and
  // nothing for a failed first read (the sections' rule: no flash).
  if (state === "hidden" || !view) return null;

  return (
    <SettingsCard id={ANCHOR} title={C.title} description={C.intro}>
      {state === "error" ? (
        // A reload of a card already drawn failed: the error, with Try again.
        <OutcomeLine tone="bad" role="alert">
          {C.loadFailed} {loadError}{" "}
          <button type="button" className={btn.link} onClick={() => { void load(); }}>{C.tryAgain}</button>
        </OutcomeLine>
      ) : view.apps.length === 0 ? (
        <div>
          <p className="m-0 text-base text-ink-2">{C.none}</p>
          {/* The how-to steps, behind Show more (settings-cleanup B6). */}
          <SettingsMore className="mt-1" about={C.title}>
            <p className="m-0">
              {view.docsUrl ? (
                <>
                  <a className={btn.link} href={view.docsUrl} target="_blank" rel="noreferrer">{C.howTo}</a>{" "}
                </>
              ) : null}
              {C.howToLine(view.address)}
            </p>
          </SettingsMore>
        </div>
      ) : (
        <div>
          {view.apps.map((a) => {
            const label = capitalFirst(a.app);
            const shown = changes[a.id];
            const workspace = a.workspace.name || a.workspace.id;
            return (
              <SettingsRow
                key={a.id}
                label={
                  <span data-ai-app-label="" className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                    {label}
                    <span className={TAG}>{C.notChecked}</span>
                  </span>
                }
                helper={C.where(workspace, a.access === "write")}
                control={
                  <button type="button" className={btn.dangerGhost} onClick={() => setConfirm(a)} disabled={busy}>
                    <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {C.disconnect}
                  </button>
                }
              >
                <p className="m-0">
                  {C.connected(fmt.date(a.connectedAt, "date"))} {a.lastUsedAt ? C.lastUsed(fmt.relative(a.lastUsedAt)) : C.neverUsed}
                </p>
                {a.blocked === "ai_off" ? <p className="m-0">{C.aiOff(workspace)}</p> : null}
                {a.blocked === "mfa" ? <p className="m-0">{MCP_TOOL_COPY.errors.holdMfa}</p> : null}
                {a.blocked === "password" ? <p className="m-0">{MCP_TOOL_COPY.errors.holdPassword}</p> : null}
                <p className="m-0">
                  {C.changes(a.changes)}
                  {a.changes > 0 ? (
                    <>
                      {" "}
                      <button type="button" className={btn.link} aria-expanded={!!shown} onClick={() => { void toggleChanges(a.id); }}>
                        {shown ? C.hideChanges : C.showChanges}
                      </button>
                    </>
                  ) : null}
                </p>
                {shown?.state === "loading" ? (
                  <p className="m-0 inline-flex items-center gap-2"><Dots variant="pending" /> {C.changesLoading}</p>
                ) : shown?.state === "error" ? (
                  <p className="m-0">{C.changesFailed}</p>
                ) : shown?.state === "ready" ? (
                  <>
                    <ul className="m-0 flex list-none flex-col p-0">
                      {shown.changes.map((c) => (
                        <li key={c.id} className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line-soft py-1.5">
                          <span className="min-w-0 flex-1 text-ink">{c.description}</span>
                          <span className="shrink-0" title={fmt.title(c.at)}>{fmt.relative(c.at)}</span>
                          {c.href ? <Link className={btn.link} href={c.href}>{C.open}</Link> : null}
                        </li>
                      ))}
                    </ul>
                    {shown.more ? <p className="m-0">{C.changesNewest(shown.changes.length)}</p> : null}
                  </>
                ) : null}
              </SettingsRow>
            );
          })}
        </div>
      )}

      {/* The accepted risk (Decision 10), said where the apps are: a
          consequence, so in sight, never behind Show more. */}
      {state === "error" ? null : <p className="m-0 text-sm text-ink-2">{C.logoutNote}</p>}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => { if (!busy && !v) setConfirm(null); }}
        title={C.disconnectTitle(confirm ? confirm.app : "")}
        confirmLabel={C.disconnect}
        danger
        busy={busy}
        onConfirm={async () => { if (confirm) await disconnect(confirm); }}
      >
        <p>{C.disconnectBody}</p>
      </ConfirmDialog>
    </SettingsCard>
  );
}
