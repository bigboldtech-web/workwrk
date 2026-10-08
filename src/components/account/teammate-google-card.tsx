"use client";

/* My settings · Calendar & connections · Google for your AI teammates
 * (docs/plans/ai-teammates-phase3.md step 2, Decision 25).
 *
 * The person's own Google account, connected to their AI teammates in this
 * workspace: what Google granted, who used it last, the teammates that use
 * it and, for a teammate someone else may change, the person's own allow per
 * product (Decision 6). Reads GET /api/teammate-connections and reads it
 * again when the tab comes back, as the page does.
 *
 * NOTHING IS DRAWN when this WorkwrK offers no Google and the person holds
 * no connection (`available` false), the precedent the Google Calendar card
 * set. A connection is always drawn, so it can always be removed (Decision
 * 27).
 *
 * Connect, Reconnect and Add are real navigations to the start route, never
 * fetches: it answers a redirect to Google. Connect is a secondary button:
 * one blue button per page (design-system 4.4), and this page's is Connect
 * Google Calendar.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Check, Link2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "@/components/settings/settings-form";
import { Dots } from "@/components/ui/dots";
import { Switch } from "@/components/ui/switch";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { CONNECTIONS_COPY as C, PRINT_FIELD_WORDS, titleList } from "@/lib/agents/teammate-copy";
import { teammateConnectSentence, type TeammateConnectionsView, type TeammateGoogleUse } from "@/lib/connectors/connection-views";
import { CONNECTOR_PRODUCTS, type ConnectorProduct } from "@/lib/connectors/products";

/** What the connect flow put in the URL, read once by the page. */
export interface TeammateConnectOutcome {
  ai: string | null;
  partial: string[];
  error: string | null;
}

const START = "/api/teammate-connections/google/start";

function productWord(p: ConnectorProduct): string {
  return p === "gmail" ? C.gmail : C.calendar;
}

function startHref(products: readonly ConnectorProduct[]): string {
  return `${START}?products=${encodeURIComponent(products.join(","))}`;
}

/** The connect flow's own outcome. */
function ResultLine({ outcome }: { outcome: TeammateConnectOutcome }) {
  if (outcome.error) {
    return (
      <p className="cxn__result cxn__result--bad">
        <TriangleAlert aria-hidden /> {C.didntConnect(teammateConnectSentence(outcome.error))}
      </p>
    );
  }
  if (outcome.ai !== "connected") return null;
  const partial = CONNECTOR_PRODUCTS.filter((p) => outcome.partial.includes(p));
  return (
    <>
      <p className="cxn__result cxn__result--ok">
        <Check aria-hidden /> {C.connectedOk}
      </p>
      {partial.map((p) => (
        <p key={p} className="cxn__result cxn__result--bad">
          <TriangleAlert aria-hidden /> {C.partial(productWord(p))}
        </p>
      ))}
    </>
  );
}

export function TeammateGoogleCard({ outcome }: { outcome: TeammateConnectOutcome }) {
  const { toast } = useOsToast();
  const fmt = useFormat();
  const [view, setView] = useState<TeammateConnectionsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ConnectorProduct[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const scrolled = useRef(false);

  const load = useCallback(async () => {
    const r = await apiFetch<TeammateConnectionsView>("/api/teammate-connections", { cache: "no-store" });
    if (!r.ok) { setLoadError(r.error); return; }
    setLoadError(null);
    setView(r.data);
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

  // Arriving at #ai-google (the callback, an Inbox row, a Reconnect link):
  // the card is drawn only once its read is back, so it scrolls itself in.
  useEffect(() => {
    if (!view || scrolled.current || typeof window === "undefined" || window.location.hash !== "#ai-google") return;
    scrolled.current = true;
    document.getElementById("ai-google")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [view]);

  const setAllow = useCallback(async (t: TeammateGoogleUse, changes: Partial<Record<ConnectorProduct, boolean>>) => {
    setBusy(`allow:${t.slug}`);
    const r = await apiFetch<{ teammate: TeammateGoogleUse }>(`/api/teammate-connections/teammates/${encodeURIComponent(t.slug)}`, { method: "PUT", json: changes });
    setBusy(null);
    if (!r.ok) { toast(r.error || C.allowFailed, { tone: "danger" }); return; }
    setView((v) => (v ? { ...v, teammates: v.teammates.map((x) => (x.slug === t.slug ? r.data.teammate : x)) } : v));
  }, [toast]);

  async function disconnect() {
    setBusy("disconnect");
    const r = await apiFetch<{ disconnected: boolean; revoked: "now" | "queued" | "kept_shared" }>("/api/teammate-connections/google", { method: "DELETE" });
    setBusy(null);
    setConfirmOpen(false);
    if (!r.ok) { toast(r.error || C.disconnectFailed, { tone: "danger" }); return; }
    toast(r.data.revoked === "kept_shared" ? `${C.disconnectedToast}. ${C.sharedNote}` : C.disconnectedToast);
    void load();
  }

  if (loadError) {
    return (
      <section className="cxn__card" id="ai-google">
        <div className="cxn__error">
          <TriangleAlert aria-hidden />
          <span>{C.loadFailed} {loadError}</span>
          <button type="button" className="cxn__link-btn" onClick={() => { void load(); }}>{C.tryAgain}</button>
        </div>
      </section>
    );
  }
  if (!view) {
    return (
      <section className="cxn__card" id="ai-google">
        <div className="cxn__loading"><Dots variant="pending" /> <span>{C.loading}</span></div>
      </section>
    );
  }
  if (!view.available) return null;

  const on = CONNECTOR_PRODUCTS.filter((p) => view.products[p] === "on");
  const connection = view.connection;
  const choice = (picked ?? on).filter((p) => on.includes(p));

  let body: React.ReactNode;
  if (view.guest) {
    body = <p className="cxn__note">{C.guestNote}</p>;
  } else if (!connection && on.length === 0) {
    body = (
      <>
        <p className="cxn__note">{C.workspaceOffMember(view.workspaceName || "your workspace")}</p>
        {view.canManagePolicy ? (
          <p className="cxn__note">
            {C.workspaceOffAdmin} <Link href="/settings/apps#ai-google">{C.appsLink}</Link>
          </p>
        ) : null}
      </>
    );
  } else if (!connection) {
    body = (
      <>
        <p className="cxn__note" id="ai-google-pick">{C.pickProducts}</p>
        <div className="cxn__cals" role="group" aria-labelledby="ai-google-pick">
          {on.map((p) => (
            <label key={p} className="cxn__cal-switch">
              <input
                type="checkbox"
                checked={choice.includes(p)}
                onChange={(e) => {
                  const next = e.target.checked ? [...new Set([...choice, p])] : choice.filter((x) => x !== p);
                  setPicked(CONNECTOR_PRODUCTS.filter((x) => next.includes(x)));
                }}
              />
              <span>
                {productWord(p)}
                <em>{p === "gmail" ? C.gmailHint : C.calendarHint}</em>
              </span>
            </label>
          ))}
        </div>
        <div className="cxn__actions">
          {choice.length > 0 ? (
            // A real navigation to a route handler that answers a redirect
            // to Google (the Google Calendar card's own reason for the disable).
             
            <a className="cxn__btn" href={startHref(choice)}>
              <Link2 aria-hidden /> {C.connect}
            </a>
          ) : (
            <span className="cxn__btn" aria-disabled="true">
              <Link2 aria-hidden /> {C.connect}
            </span>
          )}
        </div>
      </>
    );
  } else {
    const missing = on.filter((p) => !connection.products.includes(p));
    body = (
      <>
        {connection.status === "needs_reconnect" ? (
          <div className="cxn__error" role="status">
            <TriangleAlert aria-hidden />
            <span>{C.needsReconnect(fmt.date(connection.needsReconnectAt ?? connection.connectedAt, "date"))}</span>
            { }
            <a className="cxn__link-btn" href={startHref(connection.products)}>{C.reconnect}</a>
          </div>
        ) : null}
        <p className="cxn__note">
          {C.connectedAs(connection.accountEmail, fmt.date(connection.connectedAt, "date"))}{" "}
          {C.uses(titleList(connection.products.map(productWord)))}{" "}
          {connection.lastUsedAt ? C.lastUsed(fmt.relative(connection.lastUsedAt), connection.lastUsedBy ?? C.someTeammate) : C.neverUsed}
        </p>
        {missing.length > 0 && connection.status === "active" ? (
          <div className="cxn__actions">
            {missing.map((p) => (
               
              <a key={p} className="cxn__btn" href={startHref([...connection.products, p])}>
                <RefreshCw aria-hidden /> {C.addProduct(productWord(p))}
              </a>
            ))}
          </div>
        ) : null}

        <h3 className="cxn__note"><strong>{C.teammatesHeading}</strong></h3>
        {view.teammates.length === 0 ? (
          <p className="cxn__note">{C.noTeammates}</p>
        ) : (
          <ul className="cxn__cals">
            {view.teammates.map((t) => {
              const changedProducts = CONNECTOR_PRODUCTS.filter((p) => (t.changed[p] ?? []).length > 0);
              const changedParts = [...new Set(changedProducts.flatMap((p) => t.changed[p] ?? []))].map((f) => PRINT_FIELD_WORDS[f] ?? f);
              return (
                <li key={t.slug}>
                  <span className="cxn__cal-name">
                    <Bot aria-hidden /> {t.name}
                  </span>
                  {t.own ? (
                    <span className="cxn__note">{C.ownTeammate}</span>
                  ) : (
                    <>
                      {CONNECTOR_PRODUCTS.filter((p) => t.tools[p]).map((p) => {
                        const label = p === "gmail" ? C.allowGmail(t.name) : C.allowCalendar(t.name);
                        return (
                          <label key={p} className="cxn__cal-switch">
                            <span>{label}</span>
                            <Switch
                              checked={t.allowed[p]}
                              disabled={busy === `allow:${t.slug}`}
                              onChange={(next) => { void setAllow(t, { [p]: next }); }}
                              aria-label={label}
                            />
                          </label>
                        );
                      })}
                      {changedParts.length > 0 ? (
                        <p className="cxn__note">
                          {C.changedSince(titleList(changedParts, 6))}{" "}
                          <button
                            type="button"
                            className="cxn__link-btn"
                            disabled={busy === `allow:${t.slug}`}
                            onClick={() => { void setAllow(t, Object.fromEntries(changedProducts.map((p) => [p, true]))); }}
                          >
                            {C.allowAgain}
                          </button>
                        </p>
                      ) : null}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="cxn__actions">
          <button type="button" className="cxn__btn cxn__btn--danger" onClick={() => setConfirmOpen(true)} disabled={busy === "disconnect"}>
            {busy === "disconnect" ? <Dots variant="pending" /> : <Trash2 aria-hidden />} {C.disconnect}
          </button>
        </div>
      </>
    );
  }

  return (
    <section className="cxn__card" id="ai-google">
      <header className="cxn__card-head">
        <span className="cxn__card-icon"><Bot aria-hidden /></span>
        <div>
          <h2>{C.cardTitle}</h2>
          <p>{C.blurb}</p>
        </div>
      </header>
      <ResultLine outcome={outcome} />
      {body}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={C.disconnectTitle}
        confirmLabel={C.disconnect}
        danger
        busy={busy === "disconnect"}
        onConfirm={disconnect}
      >
        <p>{C.disconnectBody}</p>
      </ConfirmDialog>
    </section>
  );
}
