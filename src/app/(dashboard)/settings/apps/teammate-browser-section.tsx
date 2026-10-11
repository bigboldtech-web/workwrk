"use client";

// Apps & modules > Computer for AI teammates (docs/plans/ai-teammates-phase4.md
// step 4, Decisions 3, 4, 9, 25, 30 and 34): the workspace switch, the two
// site lists, this month's usage and Stop every browser. Owners and Admins
// only: GET /api/teammate-browser/policy answers anyone else with the Apps
// page's own refusal, and this section then draws nothing. Numbers only:
// nobody's browser, steps or pictures are ever shown here (Decision 30).
//
//   loading          nothing is drawn until the first answer (review of
//                    Phase 4 step 4: no card or intro flashes first)
//   not configured   nothing is drawn (this WorkwrK does not offer it)
//   plan or trial    the plan's line, with a link to Plan & billing
//   otherwise        the region; the switch (turning it off asks first, and
//                    ends every browser here at once); Sites teammates may
//                    open and Blocked sites, each a chip list with Remove and
//                    an Add site field, each change one POST, a refused site
//                    said under its field (SITE_PROBLEM_WORDS); the month's
//                    minutes, browsers running and sessions today, the cost
//                    only from the founder's rate; Stop every browser (asks
//                    first)
//
// Every change names the workspace the section was read in, and a session
// switched to another workspace in another tab answers workspace_changed:
// the page reloads into the workspace the person is in now. No blue button:
// the switch and the lists save as they change (the page's own rule).

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { btn, FieldError, TextInput } from "@/components/account/account-ui";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/settings/settings-form";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { Switch } from "@/components/ui/switch";
import { ErrorState } from "@/components/ui/error-state";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { BROWSER_POLICY_COPY as P, BROWSER_ROUTE_ERRORS } from "@/lib/agents/teammate-copy";
import { browserSectionShown, usageLines, type BrowserPolicyView } from "@/lib/browser/views";

const SECTION_LABEL = "mb-2 flex items-center gap-3 text-micro font-semibold uppercase tracking-[0.06em] text-ink-2";
const LINK = "font-medium text-brand-deep hover:underline";
const BILLING_HREF = "/settings/billing";

type SiteList = "allow" | "block";

export function TeammateBrowserSection() {
  const { toast } = useOsToast();
  const [view, setView] = useState<BrowserPolicyView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "hidden" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch<BrowserPolicyView>("/api/teammate-browser/policy", { cache: "no-store" });
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
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // The workspace this section was read in: every change sends it.
  const shownIn = view?.organizationId ?? "";

  /** A refusal's sentence; a session switched to another workspace reloads the page. */
  const refused = useCallback((r: { error: string; code?: string }) => {
    toast(r.error || P.saveFailed, { tone: "danger" });
    if (r.code === "workspace_changed") window.location.reload();
  }, [toast]);

  const setEnabled = useCallback(async (on: boolean): Promise<boolean> => {
    setSaving(true);
    const r = await apiFetch<BrowserPolicyView & { ended: number }>("/api/teammate-browser/policy", {
      method: "PUT",
      json: { organizationId: shownIn, enabled: on },
    });
    setSaving(false);
    if (!r.ok) {
      refused(r);
      return false;
    }
    setView(r.data);
    setSavedAt(Date.now());
    toast(r.data.ended > 0 ? `${P.saved}. ${P.stoppedAll(r.data.ended)}` : P.saved);
    return true;
  }, [shownIn, refused, toast]);

  /** One site added to or taken from one list; the field's own error, or null when it went. */
  const changeSite = useCallback(async (list: SiteList, change: { add: string } | { remove: string }): Promise<string | null> => {
    const r = await apiFetch<BrowserPolicyView & { changed: boolean }>("/api/teammate-browser/policy/sites", {
      method: "POST",
      json: { organizationId: shownIn, list, ...change },
    });
    if (!r.ok) {
      if (r.code === "workspace_changed") { refused(r); return r.error; }
      // A refused site or a full list is said under its field; anything else in a toast too.
      if (r.code !== "bad_site" && r.code !== "too_many") toast(r.error || P.saveFailed, { tone: "danger" });
      return r.error || P.saveFailed;
    }
    setView(r.data);
    return null;
  }, [shownIn, refused, toast]);

  const stopAll = useCallback(async (): Promise<boolean> => {
    const r = await apiFetch<{ ended: number }>("/api/teammate-browser/policy/stop-all", {
      method: "POST",
      json: { organizationId: shownIn, confirm: "stop" },
    });
    if (!r.ok) {
      refused(r);
      return false;
    }
    toast(P.stoppedAll(r.data.ended));
    void load();
    return true;
  }, [shownIn, refused, toast, load]);

  // Drawn only once its answer is known to be available, the plan's, a
  // trial's or a closed workspace's (review of Phase 4 step 4, views.ts
  // browserSectionShown): nothing while it loads or a reload with no answer
  // yet is in flight, for anyone the route refuses, or where this WorkwrK
  // does not offer the computer, so production never flashes its card.
  if (state === "hidden" || !view || !browserSectionShown(view)) return null;

  const planLine = !view.available ? (view.reason === "trial" ? P.trialNote : view.reason === "plan" ? P.planNote : view.reason === "workspace_closed" ? BROWSER_ROUTE_ERRORS.workspaceClosed : null) : null;

  return (
    <section>
      <h2 className={SECTION_LABEL}>
        {P.title}<span className="h-px flex-1 bg-line" aria-hidden />
      </h2>
      {/* The anchor the docs and the teammates' lines link to (/settings/apps#ai-browser). */}
      <SettingsCard id="ai-browser" title={P.title} description={planLine ? undefined : P.intro}>
        {state === "error" ? (
          // A reload of a section already known failed: its last answer said what to draw.
          <ErrorState compact what={P.errorWhat} hint={error ?? undefined} onRetry={() => { void load(); }} />
        ) : planLine ? (
          <p className="text-base text-ink-2">
            {planLine}
            {view.reason === "plan" || view.reason === "trial" ? (
              <>
                {" "}
                <Link href={BILLING_HREF} className={LINK}>{P.billingLink}</Link>
              </>
            ) : null}
          </p>
        ) : (
          <>
            {view.region ? <p className="text-sm text-ink-2">{P.regionLine(view.region)}</p> : null}
            <SettingsRow
              label={P.switchLabel}
              savedAt={savedAt}
              control={
                <Switch
                  checked={view.enabled}
                  disabled={saving}
                  onChange={(next) => {
                    if (next) void setEnabled(true);
                    else setTurningOff(true);
                  }}
                  aria-label={P.switchLabel}
                />
              }
            />
            <SiteChips list="allow" heading={P.allowHeading} hint={P.allowHint} sites={view.allowSites} onChange={changeSite} />
            <SiteChips list="block" heading={P.blockHeading} hint={P.blockHint} sites={view.blockSites} onChange={changeSite} />
            {view.usage ? (
              <div>
                <h3 className="mb-1 text-sm font-medium text-ink">{P.usageHeading}</h3>
                {usageLines(view.usage).map((line) => (
                  <p key={line} className="text-sm text-ink-2">{line}</p>
                ))}
              </div>
            ) : null}
            {/* While it is on, or any browser still runs (turning it off ends them all): the counts above may be a moment old. */}
            {view.enabled || (view.usage?.atOnce ?? 0) > 0 ? (
              <div>
                <button type="button" className={btn.dangerGhost} onClick={() => setStopOpen(true)}>
                  {P.stopAll}
                </button>
              </div>
            ) : null}
          </>
        )}
      </SettingsCard>

      <ConfirmDialog
        open={turningOff}
        onOpenChange={(v) => { if (!busy) setTurningOff(v); }}
        title={P.turnOffTitle}
        confirmLabel={P.turnOff}
        danger
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          const ok = await setEnabled(false);
          setBusy(false);
          if (ok) setTurningOff(false);
        }}
      >
        <p>{P.turnOffBody}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={stopOpen}
        onOpenChange={(v) => { if (!busy) setStopOpen(v); }}
        title={P.stopAllTitle}
        confirmLabel={P.stopAll}
        danger
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          const ok = await stopAll();
          setBusy(false);
          if (ok) setStopOpen(false);
        }}
      >
        <p>{P.stopAllBody}</p>
      </ConfirmDialog>
    </section>
  );
}

/**
 * One of the two lists: the settings pages' chip list (settings-form.tsx
 * ChipsInput's own chips and field), each change its own POST rather than a
 * whole list, so two Admins at once never lose each other's change. The
 * route parses what is typed (a pasted address gives its host) and says what
 * is wrong with it under the field.
 */
function SiteChips({
  list,
  heading,
  hint,
  sites,
  onChange,
}: {
  list: SiteList;
  heading: string;
  hint: string;
  sites: readonly string[];
  onChange: (list: SiteList, change: { add: string } | { remove: string }) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const errId = useId();

  async function add() {
    const v = draft.trim();
    if (!v || busy) return;
    setBusy(true);
    const problem = await onChange(list, { add: v });
    setBusy(false);
    setErr(problem);
    if (!problem) setDraft("");
  }

  async function remove(site: string) {
    setBusy(true);
    const problem = await onChange(list, { remove: site });
    setBusy(false);
    setErr(problem);
  }

  return (
    <div>
      <label htmlFor={inputId} className="block text-base font-medium text-ink">{heading}</label>
      <p className="mt-0.5 mb-2 text-sm text-ink-2">{hint}</p>
      {sites.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={heading}>
          {sites.map((site) => (
            <li key={site} className="inline-flex h-6 items-center gap-1 rounded-full border border-line bg-hover ps-2.5 pe-1 text-sm text-ink">
              <span className="break-all">{site}</span>
              <button
                type="button"
                onClick={() => void remove(site)}
                disabled={busy}
                aria-label={P.remove(site)}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-3 hover:bg-active hover:text-ink disabled:opacity-50"
              >
                <X className="h-3 w-3" strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <TextInput
          id={inputId}
          value={draft}
          placeholder={P.addPlaceholder}
          invalid={!!err}
          aria-describedby={err ? errId : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { setDraft(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
        />
        <button type="button" onClick={() => void add()} disabled={!draft.trim() || busy} className={cn(btn.secondary, "shrink-0 whitespace-nowrap")}>
          {P.addSite}
        </button>
      </div>
      <FieldError id={errId}>{err}</FieldError>
    </div>
  );
}
