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
 * teammate changed since is refused and the card reads again; and the
 * Google account it showed (`account`), so an allow after the person
 * reconnected as another account elsewhere is refused and the card reads
 * again (review round 4 of Phase 3).
 *
 * Connect, Reconnect and Add are real navigations to the start route, never
 * fetches: it answers a redirect to Google. Connect is a secondary button:
 * one blue button per page (design-system 4.4), and this page's is Connect
 * Google Calendar.
 *
 * DRAWN FROM THE SHARED PARTS (settings-cleanup Phase 3, B4, B5, B9): one
 * SettingsCard, its blurb the description (its privacy sentence in sight);
 * the products to connect as switch rows (never a native checkbox), the
 * connection as a row with Disconnect as its control, each teammate's allows
 * as switch rows. Nothing is drawn while the first read is out, so where
 * this WorkwrK offers no Google the card never flashes in and out (the
 * Settings side's rule since its Phase 2 review, M3); a failed read says so
 * in the card, with Try again. Arriving at #ai-google, the card lands on its
 * own anchor once it is drawn (SettingsCard's landing, which honours reduced
 * motion).
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Link2, RefreshCw, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/settings/settings-form";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { btn, OutcomeLine } from "@/components/account/account-ui";
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
  /** Another Google account ended the person's allows (review round 3 of Phase 3). */
  allowsCleared?: boolean;
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

/** The connect flow's own outcome, the first lines of the card. */
function ResultLine({ outcome }: { outcome: TeammateConnectOutcome }) {
  if (outcome.error) {
    return <OutcomeLine tone="bad" role="alert">{C.didntConnect(teammateConnectSentence(outcome.error))}</OutcomeLine>;
  }
  if (outcome.ai !== "connected") return null;
  const partial = CONNECTOR_PRODUCTS.filter((p) => outcome.partial.includes(p));
  return (
    <div className="flex flex-col gap-1">
      <OutcomeLine tone="ok" role="status">{C.connectedOk}</OutcomeLine>
      {partial.map((p) => (
        <OutcomeLine key={p} tone="bad">{C.partial(productWord(p))}</OutcomeLine>
      ))}
      {outcome.allowsCleared ? <OutcomeLine tone="bad">{C.allowsCleared}</OutcomeLine> : null}
    </div>
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
  // the card is drawn only once its read is back, and SettingsCard lands on
  // its own id when it mounts (landOnHash: in at once for anyone who asked
  // for less motion, a pulse, held while the cards above it load).

  // The workspace this card was read in (review round 1 of Phase 3): every
  // change sends it, and a route whose session moved to another workspace in
  // another tab changes nothing there and answers workspace_changed, so the
  // whole page reloads into the workspace the person is in now.
  const shownIn = view?.organizationId ?? "";
  // The Google account this card was read for (review round 4 of Phase 3).
  const shownAccount = view?.connection?.account;

  const setAllow = useCallback(async (t: TeammateGoogleUse, changes: Partial<Record<ConnectorProduct, boolean>>) => {
    setBusy(`allow:${t.slug}`);
    // `expect`: the teammate as this card showed it, so the allow covers what
    // the person saw; `account`: the Google account it showed (review round 4).
    const r = await apiFetch<{ teammate: TeammateGoogleUse }>(`/api/teammate-connections/teammates/${encodeURIComponent(t.slug)}`, {
      method: "PUT",
      json: { ...changes, expect: t.print, account: shownAccount, organizationId: shownIn },
    });
    setBusy(null);
    if (!r.ok) {
      toast(r.error || C.allowFailed, { tone: "danger" });
      if (r.code === "workspace_changed") { window.location.reload(); return; }
      // It, or the Google account, changed while the card was open: read again, so the change is shown.
      if (r.code === "teammate_changed" || r.code === "account_changed") void load();
      return;
    }
    setView((v) => (v ? { ...v, teammates: v.teammates.map((x) => (x.slug === t.slug ? r.data.teammate : x)) } : v));
  }, [toast, load, shownIn, shownAccount]);

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
      <SettingsCard id="ai-google" title={C.cardTitle}>
        <OutcomeLine tone="bad" role="alert">
          {C.loadFailed} {loadError}{" "}
          <button type="button" className={btn.link} onClick={() => { void load(); }}>{C.tryAgain}</button>
        </OutcomeLine>
      </SettingsCard>
    );
  }
  // Nothing while the first read is out: where this WorkwrK offers no Google
  // the card would otherwise flash in and out.
  if (!view) return null;
  if (!view.available) return null;

  const on = CONNECTOR_PRODUCTS.filter((p) => view.products[p] === "on");
  const connection = view.connection;
  const choice = (picked ?? on).filter((p) => on.includes(p));
  const ws = view.workspaceName || "your workspace";
  const workspaceOff = (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-base text-ink-2">{C.workspaceOffMember(ws)}</p>
      {view.canManagePolicy ? (
        <p className="m-0 text-sm text-ink-2">
          {C.workspaceOffAdmin} <Link href="/settings/apps#ai-google" className={btn.link}>{C.appsLink}</Link>
        </p>
      ) : null}
    </div>
  );

  let body: React.ReactNode;
  if (view.guest && !connection) {
    body = <p className="m-0 text-base text-ink-2">{C.guestNote}</p>;
  } else if (!connection && on.length === 0) {
    body = workspaceOff;
  } else if (!connection) {
    body = (
      <>
        <div>
          <h3 className="m-0 pb-1 text-sm font-medium text-ink" id="ai-google-pick">{C.pickProducts}</h3>
          {/* Switches, never a native checkbox (settings-cleanup B9). Each
              hint says what the teammate may do and that sending or
              inviting always asks first, so it stays in sight, and the
              switch is described by it, so a screen reader hears it too
              (Phase 3 review, L3). */}
          <div role="group" aria-labelledby="ai-google-pick">
            {on.map((p) => (
              <SettingsRow
                key={p}
                label={productWord(p)}
                helper={p === "gmail" ? C.gmailHint : C.calendarHint}
                helperId={`ai-google-hint-${p}`}
                control={
                  <Switch
                    checked={choice.includes(p)}
                    onChange={(checked) => {
                      const next = checked ? [...new Set([...choice, p])] : choice.filter((x) => x !== p);
                      setPicked(CONNECTOR_PRODUCTS.filter((x) => next.includes(x)));
                    }}
                    aria-label={productWord(p)}
                    aria-describedby={`ai-google-hint-${p}`}
                  />
                }
              />
            ))}
          </div>
        </div>
        <div>
          {choice.length > 0 ? (
            // A real navigation to a route handler that answers a redirect
            // to Google (the Google Calendar card's own reason for the disable).
            <a className={btn.secondary} href={startHref(choice, view.organizationId)}>
              <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {C.connect}
            </a>
          ) : (
            <button type="button" className={btn.secondary} disabled>
              <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {C.connect}
            </button>
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
      <div>
        <h3 className="m-0 pb-1 text-sm font-medium text-ink">{C.teammatesHeading}</h3>
        {view.teammates.length === 0 ? (
          <p className="m-0 text-base text-ink-2">{C.noTeammates}</p>
        ) : (
          <div>
            {view.teammates.map((t) => {
              // Per product it holds tools for, on here or off (review of step 5).
              const rows = teammateProductRows(t, on, connection.products);
              // "Allow again" only for a product on here: one off cannot be allowed (product_off).
              const changedProducts = CONNECTOR_PRODUCTS.filter((p) => on.includes(p) && (t.changed[p] ?? []).length > 0);
              // Every part named, the shared memories included (review round 2 of Phase 3).
              const changedParts = [...new Set(changedProducts.flatMap((p) => t.changed[p] ?? []))].map((f) => PRINT_FIELD_WORDS[f] ?? f);
              const name = (
                <span className="inline-flex items-center gap-2">
                  <Bot className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden /> {t.name}
                </span>
              );
              if (t.own) {
                return (
                  <SettingsRow key={t.slug} label={name} helper={rows.some((r) => !r.off) ? C.ownTeammate : undefined}>
                    {rows.filter((r) => r.off).map((r) => (
                      <p key={r.product} className="m-0">{C.productTurnedOff(productWord(r.product), ws)}</p>
                    ))}
                  </SettingsRow>
                );
              }
              return (
                <Fragment key={t.slug}>
                  {rows.map(({ product: p, off, showSwitch, needsAdd }) => {
                    const label = p === "gmail" ? C.allowGmail(t.name) : C.allowCalendar(t.name);
                    // A product the workspace turned off says so (review of step
                    // 5), with its switch only while an allow is on, so the
                    // person can always turn it off (Decision 27).
                    if (!showSwitch) return <SettingsRow key={p} label={name} helper={C.productTurnedOff(productWord(p), ws)} />;
                    // A product the connection lacks cannot be allowed until it is
                    // added (the PUT answers not_granted, review of step 2); one
                    // allowed already can always be turned off (Decision 27).
                    const hint = off ? C.productTurnedOff(productWord(p), ws) : needsAdd ? C.addFirst(productWord(p)) : undefined;
                    const hintId = hint ? `ai-google-hint-${t.slug}-${p}` : undefined;
                    return (
                      <SettingsRow
                        key={p}
                        label={label}
                        helper={hint}
                        helperId={hintId}
                        control={
                          <Switch
                            checked={t.allowed[p]}
                            disabled={busy === `allow:${t.slug}` || needsAdd}
                            onChange={(next) => { void setAllow(t, { [p]: next }); }}
                            aria-label={label}
                            aria-describedby={hintId}
                          />
                        }
                      />
                    );
                  })}
                  {changedParts.length > 0 ? (
                    <SettingsRow
                      label={C.changedSince(titleList(changedParts, changedParts.length))}
                      control={
                        // Named with its teammate (Phase 3 review, L2): the row's
                        // label says what changed, not whose allow it is.
                        <button
                          type="button"
                          className={btn.secondary}
                          disabled={busy === `allow:${t.slug}`}
                          aria-label={C.allowAgainNamed(t.name)}
                          onClick={() => { void setAllow(t, Object.fromEntries(changedProducts.map((p) => [p, true]))); }}
                        >
                          {C.allowAgain}
                        </button>
                      }
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    );
    body = (
      <>
        {connection.status === "needs_reconnect" ? (
          <OutcomeLine tone="bad" role="status">
            {C.needsReconnect(fmt.date(connection.needsReconnectAt ?? connection.connectedAt, "date"))}
            {view.guest ? null : (
              // A real navigation to the start route, which answers a redirect to Google.
              <>
                {" "}
                <a className={btn.link} href={startHref(connection.products, view.organizationId)}>{C.reconnect}</a>
              </>
            )}
          </OutcomeLine>
        ) : null}
        <div>
          <SettingsRow
            label={C.connectedAs(connection.accountEmail, fmt.date(connection.connectedAt, "date"))}
            helper={
              <>
                {usable.length > 0 ? `${C.uses(titleList(usable.map(productWord)))} ` : null}
                {connection.lastUsedAt ? C.lastUsed(fmt.relative(connection.lastUsedAt), connection.lastUsedBy ?? C.someTeammate) : C.neverUsed}
              </>
            }
            control={
              <button type="button" className={btn.dangerGhost} onClick={() => setConfirmOpen(true)} disabled={busy === "disconnect"}>
                {busy === "disconnect" ? <Dots variant="pending" /> : <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />} {C.disconnect}
              </button>
            }
          >
            {on.length > 0
              ? turnedOff.map((p) => (
                  <p key={p} className="m-0">{C.productTurnedOff(productWord(p), ws)}</p>
                ))
              : null}
          </SettingsRow>
        </div>
        {!view.guest && missing.length > 0 && connection.status === "active" ? (
          <div className="flex flex-wrap gap-2">
            {missing.map((p) => (
              <a key={p} className={btn.secondary} href={startHref([...connection.products, p], view.organizationId)}>
                <RefreshCw className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {C.addProduct(productWord(p))}
              </a>
            ))}
          </div>
        ) : null}

        {/* The Guest line takes the teammates' place, and with every
            product off the workspace's own line does (review of step 2). */}
        {view.guest ? <p className="m-0 text-base text-ink-2">{C.guestNote}</p> : on.length === 0 ? workspaceOff : teammates}
      </>
    );
  }

  return (
    <SettingsCard id="ai-google" title={C.cardTitle} description={C.blurb}>
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
    </SettingsCard>
  );
}
