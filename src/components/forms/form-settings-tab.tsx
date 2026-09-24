"use client";

// The builder's Settings tab (spec-tables-forms section 2 /forms/[id]). One
// 720 column of bordered cards; every control writes the form's own settings
// bucket (FormDefinition.settings) through the page's one autosave, so the
// title row's AutosaveIndicator is the "Saved" tick for all of them.
//
// Every row has a reader (settings-architecture 9.1), named beside it:
//   Accepting responses, Close on a date   the responder and embed closed
//        state, the submit route's 409, the /forms Status chip
//   Accept responses without an account     responder-access anonymousSubmit,
//        the submit route's no-person branch, the public read's
//        requiresSignIn (founder decision D16; rendered only while the org's
//        public links are not Off, and switched only by Full access)
//   One response per person                 the submit route, the responder
//   Collect the responder's email           the Responses tab's Who column
//        and the CSV (a signed-in responder's email is always known)
//   Confirmation message / redirect link    the responder's success state
//   Submit another response                 the responder's success state
//   Tell these people / daily summary        the submit route's notification,
//        the form-daily-summary cron (scripts/CRON-SETUP.md)
//   Closed message                           the responder and embed, only
//        rendered while the form is closed
//
// Read-only (a Can view reader): the same cards as label and value rows.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Picker } from "@/components/ui/picker";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { DateField } from "@/components/ui/date-field";
import { DEFAULT_CONFIRMATION_MESSAGE, DEFAULT_CLOSED_MESSAGE, MAX_NOTIFY_USERS, isFormClosed, normalizeRedirectInput, type FormSettings } from "@/lib/forms/settings";
import { cn } from "@/lib/utils";
import { useBoot } from "@/components/layout/os/boot-context";

export type Person = { id: string; firstName: string | null; lastName: string | null; email?: string | null };
const personName = (p: Person) => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Member";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-raised" aria-label={title}>
      <h2 className="m-0 border-b border-line px-5 py-3 text-base font-semibold text-ink">{title}</h2>
      <div className="flex flex-col divide-y divide-line-soft">{children}</div>
    </section>
  );
}

function Row({ label, hint, control }: { label: string; hint?: React.ReactNode; control: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-4 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-base text-ink">{label}</p>
        {hint ? <p className="m-0 mt-0.5 text-sm text-ink-2">{hint}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/** The calendar day (viewer's clock) an ISO close instant falls on. */
function dayOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Close on a date": the form closes at the END of the chosen day in the
 *  viewer's clock (23:59), so a form set to close on the 30th still takes
 *  answers all through the 30th. The server compares the instant. */
function endOfDayIso(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 0, 0);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export function FormSettingsTab({
  settings, readOnly, onChange, knownPeople, dailySummaryAvailable = false,
  linkDraft: linkDraftProp, onLinkDraftChange, anonymous,
}: {
  settings: FormSettings;
  readOnly: boolean;
  /** The daily summary's cron row is installed (GET /api/forms/[id]). */
  dailySummaryAvailable?: boolean;
  /** Names for the people already on the notify list (from GET /api/forms/[id]). */
  knownPeople?: Record<string, Person>;
  onChange: (patch: Partial<FormSettings>) => void;
  /** The Link box's text as typed, held by the page so it survives a tab
   *  switch and so the page can guard leaving while it is not a saveable
   *  link (null: nothing typed beyond what is saved). Uncontrolled without. */
  linkDraft?: string | null;
  onLinkDraftChange?: (text: string | null) => void;
  /** The D16 row. Absent: not rendered (the org's public links are Off).
   *  `onToggle` absent: shown as a value (not Full access). */
  anonymous?: { isPublic: boolean; onToggle?: (on: boolean) => void };
}) {
  const fmt = useFormat();
  const showUpcoming = useShowUpcoming();
  const [localLinkDraft, setLocalLinkDraft] = useState<string | null>(null);
  const controlled = onLinkDraftChange !== undefined;
  const linkDraft = controlled ? linkDraftProp ?? null : localLinkDraft;
  const setLinkDraft = (t: string | null) => (controlled ? onLinkDraftChange(t) : setLocalLinkDraft(t));
  // The segmented control: a confirmation message OR a redirect link. The
  // mode is local while the link is still being typed, so an empty box does
  // not throw the person back to "Show a message". Text typed but not yet a
  // link reopens on "Send them to a link" with that text still in the box.
  const [after, setAfter] = useState<"message" | "redirect">(settings.redirectUrl || linkDraft ? "redirect" : "message");
  const urlDraft = linkDraft ?? settings.redirectUrl ?? "";
  // "example.com/thanks" saves as https://example.com/thanks.
  const urlNormal = normalizeRedirectInput(urlDraft);
  const urlValid = urlNormal !== null;

  const [people, setPeople] = useState<Record<string, Person>>(knownPeople ?? {});
  const [pickOpen, setPickOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Person[] | null>(null);
  useEffect(() => {
    if (!pickOpen) return;
    let alive = true;
    const t = setTimeout(() => {
      // The whole company, not the viewer's team: /api/people/pick is the
      // picker read (the Teams directory's /api/users is team-scoped).
      const params = new URLSearchParams({ limit: "50", includeSelf: "1" });
      if (q.trim()) params.set("q", q.trim());
      void apiFetch<{ people?: Person[] }>(`/api/people/pick?${params}`, { cache: "no-store" }).then((r) => {
        if (!alive) return;
        const rows = r.ok ? r.data.people ?? [] : [];
        setHits(rows);
        setPeople((p) => ({ ...p, ...Object.fromEntries(rows.map((x) => [x.id, x])) }));
      });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [pickOpen, q]);

  const closed = isFormClosed(settings);
  // Who can send: people in this workspace, after they sign in (the
  // responder's public branch sets canSubmit to same-org only), and anyone
  // with the public link once the form accepts responses without an account.
  const orgName = useBoot().boot.org.name || "your workspace";
  const openToAnyone = !!anonymous?.isPublic && settings.acceptAnonymous;
  const onOff = (v: boolean) => (v ? "On" : "Off");

  return (
    <div className="flex flex-col gap-6">
      <Card title="Responses">
        <Row
          label="Accepting responses"
          hint={!settings.acceptingResponses ? "The form shows its closed message instead of the questions." : openToAnyone ? "Anyone with the public link can send answers." : `People at ${orgName} with the link can send answers.`}
          control={readOnly ? <span className="text-base text-ink-2">{onOff(settings.acceptingResponses)}</span> : <Switch checked={settings.acceptingResponses} onChange={(v) => onChange({ acceptingResponses: v })} aria-label="Accepting responses" />}
        />
        <Row
          label="Close on a date"
          hint={settings.closesAt ? `Closes ${fmt.date(settings.closesAt, "datetime")}` : "The form stays open until you turn it off."}
          control={readOnly ? <span className="text-base text-ink-2">{settings.closesAt ? fmt.date(settings.closesAt, "datetime") : "No date"}</span> : (
            // The one date picker (design-system 5.6), never a native
            // datetime input; its own clear affordance is "No date".
            <DateField
              value={dayOf(settings.closesAt)}
              onChange={(day) => onChange({ closesAt: day ? endOfDayIso(day) : null })}
              placeholder="No date"
              align="end"
              ariaLabel="Close on this date"
              className="w-[200px]"
            />
          )}
        />
        {anonymous ? (
          <Row
            label="Accept responses from people without an account"
            hint={
              !anonymous.isPublic
                ? "Works only while the form's public link is on. Turn that on in Share."
                : settings.acceptAnonymous
                  ? "Anyone with the public link can send it without signing in. They never see where answers go or any other answer."
                  : "Off: people sign in before they send."
            }
            control={
              anonymous.onToggle && !readOnly
                ? <Switch checked={settings.acceptAnonymous} onChange={(v) => anonymous.onToggle?.(v)} aria-label="Accept responses from people without an account" />
                : <span className="text-base text-ink-2">{onOff(settings.acceptAnonymous)}</span>
            }
          />
        ) : null}
        <Row
          label="Limit to one response per person"
          hint={openToAnyone ? "A second answer from the same signed-in person is refused. People without an account cannot be told apart." : "A second answer from the same person is refused."}
          control={readOnly ? <span className="text-base text-ink-2">{onOff(settings.oneResponsePerPerson)}</span> : <Switch checked={settings.oneResponsePerPerson} onChange={(v) => onChange({ oneResponsePerPerson: v })} aria-label="Limit to one response per person" />}
        />
        <Row
          label="Collect the responder's email"
          hint="Always collected for people signed in. On shows it under their name on the Responses tab."
          control={readOnly ? <span className="text-base text-ink-2">{onOff(settings.collectEmail)}</span> : <Switch checked={settings.collectEmail} onChange={(v) => onChange({ collectEmail: v })} aria-label="Collect the responder's email" />}
        />
      </Card>

      <Card title="After someone answers">
        <div className="flex flex-col gap-3 px-5 py-4">
          {!readOnly ? (
            <div role="radiogroup" aria-label="After someone answers" className="inline-flex w-fit rounded-md border border-line-strong p-0.5">
              {(["message", "redirect"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={after === m}
                  onClick={() => {
                    setAfter(m);
                    // Choosing the message drops the typed link on purpose, so
                    // it no longer holds the page's leave guard.
                    if (m === "message") setLinkDraft(null);
                    if (m === "message" && settings.redirectUrl) onChange({ redirectUrl: null });
                    if (m === "redirect" && urlNormal) onChange({ redirectUrl: urlNormal });
                  }}
                  className={cn("h-8 rounded px-3 text-sm font-medium", after === m ? "bg-active text-ink" : "text-ink-2 hover:bg-hover")}
                >
                  {m === "message" ? "Show a message" : "Send them to a link"}
                </button>
              ))}
            </div>
          ) : null}
          {after === "message" ? (
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-2">
              Confirmation message
              <textarea
                rows={2}
                value={settings.confirmationMessage}
                onChange={(e) => onChange({ confirmationMessage: e.target.value })}
                onBlur={(e) => { if (!e.target.value.trim()) onChange({ confirmationMessage: DEFAULT_CONFIRMATION_MESSAGE }); }}
                disabled={readOnly}
                maxLength={1000}
                className="rounded-md border border-line-strong bg-raised px-3 py-2 text-base font-normal text-ink disabled:bg-subtle"
              />
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-2">
              Link
              <input
                type="url"
                value={urlDraft}
                onChange={(e) => {
                  const v = e.target.value;
                  // The text is kept as typed (the page guards leaving while
                  // it is not a link); only a real link reaches the draft.
                  setLinkDraft(v);
                  const normal = normalizeRedirectInput(v);
                  if (normal) onChange({ redirectUrl: normal });
                }}
                placeholder="https://example.com/thanks"
                disabled={readOnly}
                aria-invalid={!!urlDraft && !urlValid}
                className="h-9 rounded-md border border-line-strong bg-raised px-3 text-base font-normal text-ink disabled:bg-subtle"
              />
              {urlDraft.trim() && !urlValid ? (
                <span role="alert" className="font-normal text-danger-text">This is not a web address, so it is not saved. Try one like https://example.com/thanks</span>
              ) : urlNormal && !/^[a-z][a-z0-9+.-]*:/i.test(urlDraft.trim()) ? (
                <span className="font-normal text-ink-2">Links to {urlNormal}</span>
              ) : null}
            </label>
          )}
        </div>
        <Row
          label={'Show a "Submit another response" link'}
          control={readOnly ? <span className="text-base text-ink-2">{onOff(settings.allowAnother)}</span> : <Switch checked={settings.allowAnother} onChange={(v) => onChange({ allowAnother: v })} aria-label="Show a Submit another response link" />}
        />
      </Card>

      <Card title="Notifications">
        <div className="flex flex-col gap-2 px-5 py-4">
          <p className="m-0 text-base text-ink">Tell these people about each new response</p>
          <div className="relative flex flex-wrap items-center gap-1.5">
            {settings.notifyUserIds.map((id) => (
              <span key={id} className="inline-flex h-7 items-center gap-1 rounded-md bg-subtle px-2 text-sm text-ink">
                {people[id] ? personName(people[id]) : "A person"}
                {!readOnly ? (
                  <button type="button" aria-label={`Stop telling ${people[id] ? personName(people[id]) : "this person"}`} onClick={() => onChange({ notifyUserIds: settings.notifyUserIds.filter((x) => x !== id) })} className="text-ink-2 hover:text-ink">
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </span>
            ))}
            {settings.notifyUserIds.length === 0 && readOnly ? <span className="text-base text-ink-2">Nobody</span> : null}
            {!readOnly && settings.notifyUserIds.length < MAX_NOTIFY_USERS ? (
              <span className="relative">
                <button type="button" onClick={() => { setHits(null); setPickOpen((o) => !o); }} aria-haspopup="listbox" aria-expanded={pickOpen} className="inline-flex h-7 items-center rounded-md px-2 text-sm font-medium text-brand-deep hover:bg-hover">
                  Add people
                </button>
                <Picker
                  open={pickOpen}
                  onClose={() => setPickOpen(false)}
                  sections={[{ options: (hits ?? []).map((p) => ({ value: p.id, label: personName(p), description: p.email ?? undefined })) }]}
                  selected={settings.notifyUserIds}
                  multi
                  onSelect={(id) => onChange({ notifyUserIds: settings.notifyUserIds.includes(id) ? settings.notifyUserIds.filter((x) => x !== id) : [...settings.notifyUserIds, id] })}
                  alwaysSearch
                  onSearchChange={setQ}
                  searchPlaceholder="Search people"
                  loading={hits === null}
                  ariaLabel="People to tell"
                />
              </span>
            ) : null}
          </div>
        </div>
        {/* Rendered only once its reader exists (the form-daily-summary cron
            row, settings-architecture 9.1); until then every response is
            notified one by one. */}
        {dailySummaryAvailable ? (
          <Row
            label="Send a daily summary instead"
            hint="One notification a day counting the new responses, instead of one per response."
            control={readOnly ? <span className="text-base text-ink-2">{onOff(settings.dailySummary)}</span> : <Switch checked={settings.dailySummary} disabled={settings.notifyUserIds.length === 0} onChange={(v) => onChange({ dailySummary: v })} aria-label="Send a daily summary instead" />}
          />
        ) : null}
      </Card>

      {closed ? (
        <Card title="Closed message">
          <div className="px-5 py-4">
            <textarea
              rows={2}
              aria-label="Closed message"
              value={settings.closedMessage}
              onChange={(e) => onChange({ closedMessage: e.target.value })}
              onBlur={(e) => { if (!e.target.value.trim()) onChange({ closedMessage: DEFAULT_CLOSED_MESSAGE }); }}
              disabled={readOnly}
              maxLength={1000}
              className="w-full rounded-md border border-line-strong bg-raised px-3 py-2 text-base text-ink disabled:bg-subtle"
            />
          </div>
        </Card>
      ) : null}

      {showUpcoming ? <p className="m-0 text-sm text-ink-3">Themes, logos and backdrops for forms are coming.</p> : null}
    </div>
  );
}
