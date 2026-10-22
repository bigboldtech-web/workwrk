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
 * disconnected for safety link here, and the card scrolls itself in once its
 * read is back. No blue button: this page's one is Connect Google Calendar
 * (design-system 4.4). Every sentence comes from src/lib/mcp/mcp-copy.ts.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plug, Trash2, TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "@/components/settings/settings-form";
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

export function ConnectedAppsCard() {
  const { toast } = useOsToast();
  const fmt = useFormat();
  const [view, setView] = useState<ConnectedAppsView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "hidden" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, Changes>>({});
  const [confirm, setConfirm] = useState<ConnectedApp | null>(null);
  const [busy, setBusy] = useState(false);
  const scrolled = useRef(false);

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

  // Arriving at #ai-apps (an Inbox notice): the card is drawn only once its read is back, so it scrolls itself in.
  useEffect(() => {
    if (!view || scrolled.current || typeof window === "undefined" || window.location.hash !== `#${ANCHOR}`) return;
    scrolled.current = true;
    document.getElementById(ANCHOR)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [view]);

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

  if (state === "error") {
    return (
      <section className="cxn__card" id={ANCHOR}>
        <div className="cxn__error">
          <TriangleAlert aria-hidden />
          <span>{C.loadFailed} {loadError}</span>
          <button type="button" className="cxn__link-btn" onClick={() => { void load(); }}>{C.tryAgain}</button>
        </div>
      </section>
    );
  }

  return (
    <section className="cxn__card" id={ANCHOR}>
      <header className="cxn__card-head">
        <span className="cxn__card-icon"><Plug aria-hidden /></span>
        <div>
          <h2>{C.title}</h2>
          <p>{C.intro}</p>
        </div>
      </header>

      {view.apps.length === 0 ? (
        <>
          <p className="cxn__note">{C.none}</p>
          <p className="cxn__note">
            {view.docsUrl ? (
              <>
                <a className="cxn__link-btn" href={view.docsUrl} target="_blank" rel="noreferrer">{C.howTo}</a>{" "}
              </>
            ) : null}
            {C.howToLine(view.address)}
          </p>
        </>
      ) : (
        <ul className="cxn__cals">
          {view.apps.map((a) => {
            const label = capitalFirst(a.app);
            const shown = changes[a.id];
            const workspace = a.workspace.name || a.workspace.id;
            return (
              <li key={a.id}>
                <span className="cxn__cal-name">
                  {label}
                  <em>{C.notChecked}</em>
                </span>
                <button type="button" className="cxn__btn cxn__btn--danger" onClick={() => setConfirm(a)} disabled={busy}>
                  <Trash2 aria-hidden /> {C.disconnect}
                </button>
                <div className="flex w-full flex-col gap-1">
                  <p className="cxn__note">{C.where(workspace, a.access === "write")}</p>
                  <p className="cxn__note">
                    {C.connected(fmt.date(a.connectedAt, "date"))} {a.lastUsedAt ? C.lastUsed(fmt.relative(a.lastUsedAt)) : C.neverUsed}
                  </p>
                  {a.blocked === "ai_off" ? <p className="cxn__note">{C.aiOff(workspace)}</p> : null}
                  {a.blocked === "mfa" ? <p className="cxn__note">{MCP_TOOL_COPY.errors.holdMfa}</p> : null}
                  {a.blocked === "password" ? <p className="cxn__note">{MCP_TOOL_COPY.errors.holdPassword}</p> : null}
                  <p className="cxn__note">
                    {C.changes(a.changes)}
                    {a.changes > 0 ? (
                      <>
                        {" "}
                        <button type="button" className="cxn__link-btn" aria-expanded={!!shown} onClick={() => { void toggleChanges(a.id); }}>
                          {shown ? C.hideChanges : C.showChanges}
                        </button>
                      </>
                    ) : null}
                  </p>
                  {shown?.state === "loading" ? (
                    <p className="cxn__note"><Dots variant="pending" /> {C.changesLoading}</p>
                  ) : shown?.state === "error" ? (
                    <p className="cxn__note">{C.changesFailed}</p>
                  ) : shown?.state === "ready" ? (
                    <>
                      <ul className="cxn__cals">
                        {shown.changes.map((c) => (
                          <li key={c.id}>
                            <span className="cxn__note">{c.description}</span>
                            <span className="cxn__note" title={fmt.title(c.at)}>{fmt.relative(c.at)}</span>
                            {c.href ? <Link className="cxn__link-btn" href={c.href}>{C.open}</Link> : null}
                          </li>
                        ))}
                      </ul>
                      {shown.more ? <p className="cxn__note">{C.changesNewest(shown.changes.length)}</p> : null}
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* The accepted risk (Decision 10), said where the apps are. */}
      <p className="cxn__note">{C.logoutNote}</p>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => { if (!busy && !v) setConfirm(null); }}
        title={C.disconnectTitle(confirm ? capitalFirst(confirm.app) : "")}
        confirmLabel={C.disconnect}
        danger
        busy={busy}
        onConfirm={async () => { if (confirm) await disconnect(confirm); }}
      >
        <p>{C.disconnectBody}</p>
      </ConfirmDialog>
    </section>
  );
}
