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
 * 27): for a Guest or an agent account too, where the Guest line takes the
 * place of Connect, Add, Reconnect and the teammates only (review of step 2).
 *
 * WHAT IT SAYS TEAMMATES MAY USE is what Google granted AND the workspace has
 * on now; a granted product the workspace turned off is named as such, and
 * with every product off the workspace's own line takes the teammates' place.
 * The teammates are listed by the Google tools they hold, on or off (review
 * of step 5): a product off reads as off on its row, never as "none of your
 * teammates has Google tools".
 * An allow sends back the teammate as the card showed it (`print`), so a
 * teammate changed since is refused and the card reads again.
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
import { teammateConnectSentence, teammateProductRows, type TeammateConnectionsView, type TeammateGoogleUse } from "@/lib/connectors/connection-views";
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

/**
 * Connect, Reconnect and Add, for the workspace this card was read in (review
 * round 2 of Phase 3): the start route connects nothing when the session
 * moved to another workspace in another tab, and lands back here with
 * ai_error=workspace_changed.
 */
function startHref(products: readonly ConnectorProduct[], organizationId: string): string {
  return `${START}?products=${encodeURIComponent(products.join(","))}&ws=${encodeURIComponent(organizationId)}`;
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

  // The workspace this card was read in (review round 1 of Phase 3): every
  // change sends it, and a route whose session moved to another workspace in
  // another tab changes nothing there and answers workspace_changed, so the
  // whole page reloads into the workspace the person is in now.
  const shownIn = view?.organizationId ?? "";

  const setAllow = useCallback(async (t: TeammateGoogleUse, changes: Partial<Record<ConnectorProduct, boolean>>) => {
    setBusy(`allow:${t.slug}`);
    // `expect`: the teammate as this card showed it, so the allow covers what the person saw.
    const r = await apiFetch<{ teammate: TeammateGoogleUse }>(`/api/teammate-connections/teammates/${encodeURIComponent(t.slug)}`, {
      method: "PUT",
      json: { ...changes, expect: t.print, organizationId: shownIn },
    });
    setBusy(null);
    if (!r.ok) {
      toast(r.error || C.allowFailed, { tone: "danger" });
      if (r.code === "workspace_changed") { window.location.reload(); return; }
      // It changed while the card was open: read again, so the new parts are shown.
      if (r.code === "teammate_changed") void load();
      return;
    }
    setView((v) => (v ? { ...v, teammates: v.teammates.map((x) => (x.slug === t.slug ? r.data.teammate : x)) } : v));
  }, [toast, load, shownIn]);

  async function disconnect() {
    setBusy("disconnect");
    const r = await apiFetch<{ disconnected: boolean; revoked: "now" | "queued" | "kept_shared" }>("/api/teammate-connections/google", {
      method: "DELETE",
      json: { organizationId: shownIn },
    });
    setBusy(null);
    setConfirmOpen(false);
    if (!r.ok) {
      toast(r.error || C.disconnectFailed, { tone: "danger" });
      if (r.code === "workspace_changed") window.location.reload();
      return;
    }
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
  const ws = view.workspaceName || "your workspace";
  const workspaceOff = (
    <>
      <p className="cxn__note">{C.workspaceOffMember(ws)}</p>
      {view.canManagePolicy ? (
        <p className="cxn__note">
          {C.workspaceOffAdmin} <Link href="/settings/apps#ai-google">{C.appsLink}</Link>
        </p>
      ) : null}
    </>
  );

  let body: React.ReactNode;
  if (view.guest && !connection) {
    body = <p className="cxn__note">{C.guestNote}</p>;
  } else if (!connection && on.length === 0) {
    body = workspaceOff;
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
             
            <a className="cxn__btn" href={startHref(choice, view.organizationId)}>
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
    // What teammates may use now: granted by Google AND on in the workspace
    // (review of step 2). A granted product the workspace turned off is named.
    const usable = connection.products.filter((p) => on.includes(p));
    const turnedOff = connection.products.filter((p) => !on.includes(p));
    const missing = on.filter((p) => !connection.products.includes(p));
    const teammates = (
      <>
        <h3 className="cxn__note"><strong>{C.teammatesHeading}</strong></h3>
        {view.teammates.length === 0 ? (
          <p className="cxn__note">{C.noTeammates}</p>
        ) : (
          <ul className="cxn__cals">
            {view.teammates.map((t) => {
              // Per product it holds tools for, on here or off (review of step 5).
              const rows = teammateProductRows(t, on, connection.products);
              // "Allow again" only for a product on here: one off cannot be allowed (product_off).
              const changedProducts = CONNECTOR_PRODUCTS.filter((p) => on.includes(p) && (t.changed[p] ?? []).length > 0);
              // Every part named, the shared memories included (review round 2 of Phase 3).
              const changedParts = [...new Set(changedProducts.flatMap((p) => t.changed[p] ?? []))].map((f) => PRINT_FIELD_WORDS[f] ?? f);
              return (
                <li key={t.slug}>
                  <span className="cxn__cal-name">
                    <Bot aria-hidden /> {t.name}
                  </span>
                  {t.own ? (
                    <>
                      {rows.some((r) => !r.off) ? <span className="cxn__note">{C.ownTeammate}</span> : null}
                      {rows.filter((r) => r.off).map((r) => (
                        <span key={r.product} className="cxn__note">{C.productTurnedOff(productWord(r.product), ws)}</span>
                      ))}
                    </>
                  ) : (
                    <>
                      {rows.map(({ product: p, off, showSwitch, needsAdd }) => {
                        const label = p === "gmail" ? C.allowGmail(t.name) : C.allowCalendar(t.name);
                        // A product the workspace turned off says so (review of step
                        // 5), with its switch only while an allow is on, so the
                        // person can always turn it off (Decision 27).
                        if (!showSwitch) return <p key={p} className="cxn__note">{C.productTurnedOff(productWord(p), ws)}</p>;
                        // A product the connection lacks cannot be allowed until it is
                        // added (the PUT answers not_granted, review of step 2); one
                        // allowed already can always be turned off (Decision 27).
                        return (
                          <label key={p} className="cxn__cal-switch">
                            <span>
                              {label}
                              {off ? <em>{C.productTurnedOff(productWord(p), ws)}</em> : needsAdd ? <em>{C.addFirst(productWord(p))}</em> : null}
                            </span>
                            <Switch
                              checked={t.allowed[p]}
                              disabled={busy === `allow:${t.slug}` || needsAdd}
                              onChange={(next) => { void setAllow(t, { [p]: next }); }}
                              aria-label={label}
                            />
                          </label>
                        );
                      })}
                      {changedParts.length > 0 ? (
                        <p className="cxn__note">
                          {C.changedSince(titleList(changedParts, changedParts.length))}{" "}
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
      </>
    );
    body = (
      <>
        {connection.status === "needs_reconnect" ? (
          <div className="cxn__error" role="status">
            <TriangleAlert aria-hidden />
            <span>{C.needsReconnect(fmt.date(connection.needsReconnectAt ?? connection.connectedAt, "date"))}</span>
            {view.guest ? null : (
              // A real navigation to the start route, which answers a redirect to Google.
              <a className="cxn__link-btn" href={startHref(connection.products, view.organizationId)}>{C.reconnect}</a>
            )}
          </div>
        ) : null}
        <p className="cxn__note">
          {C.connectedAs(connection.accountEmail, fmt.date(connection.connectedAt, "date"))}{" "}
          {usable.length > 0 ? `${C.uses(titleList(usable.map(productWord)))} ` : null}
          {connection.lastUsedAt ? C.lastUsed(fmt.relative(connection.lastUsedAt), connection.lastUsedBy ?? C.someTeammate) : C.neverUsed}
        </p>
        {on.length > 0
          ? turnedOff.map((p) => (
              <p key={p} className="cxn__note">{C.productTurnedOff(productWord(p), ws)}</p>
            ))
          : null}
        {!view.guest && missing.length > 0 && connection.status === "active" ? (
          <div className="cxn__actions">
            {missing.map((p) => (
              <a key={p} className="cxn__btn" href={startHref([...connection.products, p], view.organizationId)}>
                <RefreshCw aria-hidden /> {C.addProduct(productWord(p))}
              </a>
            ))}
          </div>
        ) : null}

        {/* The Guest line takes the teammates' place, and with every
            product off the workspace's own line does (review of step 2). */}
        {view.guest ? <p className="cxn__note">{C.guestNote}</p> : on.length === 0 ? workspaceOff : teammates}

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
