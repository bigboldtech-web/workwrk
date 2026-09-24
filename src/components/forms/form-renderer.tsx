"use client";

// FormRenderer: the ONE responder (spec-tables-forms section 3).
//
// Used by /forms/[id]/respond (the public page), /embed/forms/[id] (the
// iframe), the board FORM view and, later, the builder's Preview drawer. It
// replaces two hand-copied FieldInput components that disagreed about the
// checkbox label (hard-coded "Yes") and about an empty number (stored "").
//
// What it owns: the field inputs by type, inline validation (never a modal
// confirm, never alert()), the in-flight Submit, the success state and the
// closed state. What it does NOT own: loading the form, where answers go, and
// what a failed send means. The caller's onSubmit answers with an outcome and
// the renderer shows it; the typed answers never leave the screen on a failure.
//
// Tokens only (--os-* through the Tailwind aliases). The public pages import
// tokens.css and os.css themselves, since they sit outside the dashboard.

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleAlert, Paperclip, Star, X } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { DateField } from "@/components/ui/date-field";
import { Picker } from "@/components/ui/picker";
import { Switch } from "@/components/ui/switch";
import {
  MAX_FILES_PER_ANSWER, MAX_PEOPLE_PER_ANSWER, isQuestion, missingRequired, missingSummary, numberAnswer, ratingMax, readFileAnswer,
  type FileAnswer, type FormAnswers, type FormField,
} from "@/lib/forms/fields";

/** What the person filling the form may do beyond typing: choose people from
 *  the workspace and attach files both need a session in the form's org (the
 *  people list is the workspace directory; an upload lands in the org's
 *  store). A signed-out visitor sees the field with one line saying so. */
export interface RendererAbilities {
  pickPeople: boolean;
  upload: boolean;
  /** For a signed-out visitor: where "Sign in" goes (the responder's
   *  /login?callbackUrl= round trip, or the embed's new tab carrying the
   *  answers). Present only when signing in is what would let them answer
   *  the People and File upload questions. */
  signIn?: { href: string; newTab?: boolean; onClick?: () => void };
  /** Set by the renderer itself outside "live": nothing uploads or signs in. */
  inert?: boolean;
}
const AbilitiesCtx = createContext<RendererAbilities>({ pickPeople: false, upload: false });

/** Sign in to ..., as a link when the caller says where signing in goes.
 *  Plain text flow, not flex: as flex items the link and the sentence shrank
 *  side by side inside a fixed 36px box, so on a phone "Sign" and "in"
 *  stacked and the sentence pressed on the border. Now the line wraps like a
 *  sentence and the box grows with it (36px tall while it fits on one line). */
function SignInLine({ text, signIn }: { text: string; signIn?: RendererAbilities["signIn"] }) {
  return (
    <p className="m-0 min-h-9 rounded-md border border-dashed border-line-strong px-3 py-2 text-sm leading-5 text-ink-2">
      {signIn ? (
        <a
          href={signIn.href}
          target={signIn.newTab ? "_blank" : undefined}
          rel={signIn.newTab ? "noopener" : undefined}
          onClick={signIn.onClick}
          className="whitespace-nowrap font-medium text-brand-deep hover:underline"
        >
          Sign in
        </a>
      ) : "Sign in"}
      &nbsp;{text}
    </p>
  );
}

export interface RendererForm {
  id: string;
  name: string;
  description?: string | null;
  fields: FormField[];
  settings: {
    closed: boolean;
    confirmationMessage: string;
    closedMessage: string;
    allowAnother: boolean;
    redirectUrl?: string | null;
  };
}

export type SubmitOutcome =
  | { ok: true }
  | {
      ok: false;
      message: string;
      /** A text link after the message: "Sign in", "Open in a new tab", "Retry". */
      /** `retry`: the renderer presses Submit again itself, with the answers
       *  on screen (the caller cannot reach the renderer's submit). */
      action?: { label: string; onClick?: () => void; href?: string; newTab?: boolean; retry?: boolean };
      /** The server named fields it found unanswered. */
      fieldIds?: string[];
    };

export function FormRenderer({
  form,
  mode = "live",
  answers,
  onAnswersChange,
  onSubmit,
  variant = "page",
  allowRedirect = false,
  footer,
  abilities = { pickPeople: false, upload: false },
  showHelpText = true,
  numbers,
}: {
  form: RendererForm;
  mode?: "live" | "preview" | "view";
  answers: FormAnswers;
  onAnswersChange: (next: FormAnswers) => void;
  onSubmit: (answers: FormAnswers) => Promise<SubmitOutcome>;
  /* mode: "live" answers and sends; "preview" is the builder's drawer (inputs
   * work, Submit is disabled, a banner says nothing is saved); "view" is the
   * read-only builder for a Can view holder (the form as a responder sees it,
   * every input disabled, no Submit). */
  /** "page" for the responder (card inside a 640 column), "embed" for iframes. */
  variant?: "page" | "embed";
  /** Only the top-level responder may navigate the window to a redirect URL. */
  allowRedirect?: boolean;
  /** Under the Submit button: "Open in WorkwrK", "Powered by WorkwrK". */
  footer?: React.ReactNode;
  abilities?: RendererAbilities;
  /** The builder preview's Display > Show help text (default on). */
  showHelpText?: boolean;
  /** The builder preview's Display > Show field numbers: field id to number. */
  numbers?: Map<string, number>;
}) {
  const [invalid, setInvalid] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Extract<SubmitOutcome, { ok: false }> | null>(null);
  const [done, setDone] = useState(false);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  // Re-validate as the person types once they have tried to send, so a red
  // field turns back to normal the moment it is answered.
  // A People or File upload question needs a session to answer (the people
  // list is the workspace directory; an upload lands in the org's store). For
  // a visitor who cannot answer them here, they are not checked locally: the
  // send goes on to onSubmit, which takes a signed-out visitor through
  // sign-in with every answer kept (spec /forms/[id]/respond), and the server
  // still refuses a required one left empty once they are signed in.
  const answerable = useMemo(() => {
    const blocked = new Set<string>();
    for (const f of form.fields) {
      if ((f.type === "file" && !abilities.upload) || (f.type === "people" && !abilities.pickPeople)) blocked.add(f.id);
    }
    return blocked;
  }, [form.fields, abilities.upload, abilities.pickPeople]);
  const checkRequired = useMemo(
    () => (a: FormAnswers) => missingRequired(form.fields, a).filter((id) => !answerable.has(id)),
    [form.fields, answerable],
  );
  const liveInvalid = useMemo(
    () => (attempted ? checkRequired(answers) : invalid),
    [attempted, checkRequired, answers, invalid],
  );

  const setAnswer = (id: string, value: unknown) => onAnswersChange({ ...answers, [id]: value });

  async function submit() {
    if (mode !== "live" || sending) return;
    setAttempted(true);
    const missing = checkRequired(answers);
    setInvalid(missing);
    if (missing.length > 0) {
      fieldRefs.current[missing[0]]?.focus();
      return;
    }
    setSending(true);
    setFailure(null);
    try {
      const out = await onSubmit(answers);
      if (out.ok) {
        setDone(true);
        setAttempted(false);
      } else {
        setFailure(out);
        if (out.fieldIds?.length) {
          setInvalid(out.fieldIds);
          fieldRefs.current[out.fieldIds[0]]?.focus();
        }
      }
    } finally {
      setSending(false);
    }
  }

  // Redirect after a successful send, after a one-second line (spec: "Thanks,
  // sending you on"). Only the top-level page may do it.
  useEffect(() => {
    if (!done || !allowRedirect || !form.settings.redirectUrl) return;
    const t = window.setTimeout(() => { window.location.assign(form.settings.redirectUrl as string); }, 1000);
    return () => window.clearTimeout(t);
  }, [done, allowRedirect, form.settings.redirectUrl]);

  const header = (
    <header className="border-b border-line pb-5">
      <h1 className="text-xl font-semibold text-ink">{form.name || "Untitled form"}</h1>
      {form.description ? <p className="mt-1 whitespace-pre-wrap text-row text-ink-2">{form.description}</p> : null}
    </header>
  );

  if (done) {
    const redirecting = allowRedirect && !!form.settings.redirectUrl;
    return (
      <Shell variant={variant}>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-row text-ink">{redirecting ? "Thanks, sending you on" : form.settings.confirmationMessage}</p>
          {!redirecting && form.settings.allowAnother ? (
            <button
              type="button"
              className="text-sm font-medium text-brand-deep hover:underline"
              onClick={() => { onAnswersChange({}); setDone(false); setInvalid([]); setFailure(null); }}
            >
              Submit another response
            </button>
          ) : null}
        </div>
        {footer}
      </Shell>
    );
  }

  if (form.settings.closed && mode === "live") {
    return (
      <Shell variant={variant}>
        {header}
        <p className="py-8 text-center text-row text-ink-2">{form.settings.closedMessage}</p>
        {variant === "embed" && form.fields.length > 0 ? (
          <fieldset disabled className="flex flex-col gap-4 opacity-60">
            {form.fields.map((f) => (
              <FieldBlock key={f.id} field={f} value={answers[f.id]} onChange={() => undefined} invalid={false} registerRef={() => undefined} />
            ))}
          </fieldset>
        ) : null}
        {footer}
      </Shell>
    );
  }

  if (!form.fields.some(isQuestion)) {
    return (
      <Shell variant={variant}>
        {header}
        <p className="py-8 text-center text-row text-ink-2">This form has no questions yet.</p>
        {footer}
      </Shell>
    );
  }

  const missingCount = liveInvalid.length;
  return (
    <Shell variant={variant}>
      {header}
      <form
        noValidate
        className="mt-5 flex flex-col gap-4"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter sends from a textarea, where a bare Enter is a newline.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); }
        }}
      >
        {mode === "preview" ? (
          <p className="rounded-md bg-subtle px-3 py-2 text-sm text-ink-2">This is a preview. Nothing is saved.</p>
        ) : null}
        <AbilitiesCtx.Provider value={mode === "live" ? abilities : { ...abilities, upload: false, signIn: undefined, inert: true }}>
          <fieldset disabled={mode === "view"} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          {form.fields.map((f) => (
            <FieldBlock
              key={f.id}
              field={showHelpText ? f : { ...f, placeholder: f.type === "section" ? f.placeholder : undefined }}
              value={answers[f.id]}
              onChange={(v) => setAnswer(f.id, v)}
              invalid={liveInvalid.includes(f.id)}
              registerRef={(el) => { fieldRefs.current[f.id] = el; }}
              number={numbers?.get(f.id)}
            />
          ))}
          </fieldset>
        </AbilitiesCtx.Provider>
        {mode === "view" ? null : (
        <div className="mt-2 flex flex-col items-start gap-2">
          {missingCount > 0 ? <p className="text-sm text-danger-text" role="alert">{missingSummary(missingCount)}</p> : null}
          {failure ? (
            <p className="text-sm text-danger-text" role="alert">
              {failure.message}
              {failure.action ? (
                <>
                  {" "}
                  {failure.action.href ? (
                    <a
                      href={failure.action.href}
                      target={failure.action.newTab ? "_blank" : undefined}
                      rel={failure.action.newTab ? "noopener" : undefined}
                      onClick={failure.action.onClick}
                      className="font-medium text-brand-deep underline"
                    >
                      {failure.action.label}
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={failure.action.retry ? () => void submit() : failure.action.onClick}
                      disabled={sending}
                      className="font-medium text-brand-deep underline disabled:cursor-default disabled:opacity-60"
                    >
                      {failure.action.label}
                    </button>
                  )}
                </>
              ) : null}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={mode === "preview" || sending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-base font-medium text-ink-inv hover:bg-brand-hover disabled:cursor-default disabled:opacity-60"
          >
            {sending ? <Dots variant="pending" /> : null}
            Submit
          </button>
        </div>
        )}
      </form>
      {footer}
    </Shell>
  );
}

function Shell({ variant, children }: { variant: "page" | "embed"; children: React.ReactNode }) {
  if (variant === "embed") {
    return <div className="mx-auto w-full max-w-[640px] rounded-lg bg-raised p-4 min-[480px]:border min-[480px]:border-line min-[480px]:p-8">{children}</div>;
  }
  return <div className="rounded-lg border border-line bg-raised p-6 sm:p-8">{children}</div>;
}

const INPUT_CLS =
  "h-9 w-full rounded-md border bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus";

function FieldBlock({
  field, value, onChange, invalid, registerRef, number,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  invalid: boolean;
  registerRef: (el: HTMLElement | null) => void;
  number?: number;
}) {
  const id = useId();
  const abilities = useContext(AbilitiesCtx);
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const border = invalid ? "border-danger-solid" : "border-line-strong";
  const describedBy = [field.placeholder ? helpId : null, invalid ? errId : null].filter(Boolean).join(" ") || undefined;
  const label = `${number ? `${number}. ` : ""}${field.label || "Untitled question"}`;

  // A section is a heading block, not a question.
  if (field.type === "section") {
    return (
      <div className="mt-2 border-t border-line pt-5">
        <h2 className="text-lg font-semibold text-ink">{field.label || "Section"}</h2>
        {field.placeholder ? <p className="mt-1 whitespace-pre-wrap text-base text-ink-2">{field.placeholder}</p> : null}
      </div>
    );
  }

  const labelRow = (
    <label htmlFor={id} className="text-base font-medium text-ink">
      {label}
      {field.required ? <span className="ml-1 text-sm font-normal text-ink-2">(required)</span> : null}
    </label>
  );
  const help = field.placeholder ? <p id={helpId} className="text-sm text-ink-2">{field.placeholder}</p> : null;
  const error = invalid ? (
    <p id={errId} className="flex items-center gap-1.5 text-sm text-danger-text">
      <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
      Please answer this question
    </p>
  ) : null;

  const t = field.type;
  let control: React.ReactNode;
  if (t === "long_text") {
    control = (
      <textarea
        id={id}
        ref={registerRef}
        rows={3}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => {
          onChange(e.target.value);
          // Auto-grow up to twelve rows.
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 12 * 22)}px`;
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`w-full rounded-md border ${border} bg-raised px-3 py-2 text-base text-ink focus:outline-none focus:ring-2 focus:ring-focus`}
      />
    );
  } else if (t === "number") {
    control = (
      <input
        id={id}
        ref={registerRef}
        type="number"
        inputMode="decimal"
        value={typeof value === "number" && Number.isFinite(value) ? String(value) : ""}
        onChange={(e) => onChange(numberAnswer(e.target.value))}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`${INPUT_CLS} ${border} tabular-nums`}
      />
    );
  } else if (t === "date") {
    // The one date picker (design-system 5.4 and 5.6: never a native date
    // input). The answer stays a "YYYY-MM-DD" calendar day.
    control = (
      <div ref={registerRef as (el: HTMLDivElement | null) => void} tabIndex={-1} className={`w-fit min-w-[220px] rounded-md ${invalid ? "ring-1 ring-danger-solid" : ""}`} aria-describedby={describedBy}>
        <DateField
          value={typeof value === "string" && value ? value : null}
          onChange={(next) => onChange(next ?? "")}
          placeholder="Pick a date"
          ariaLabel={label}
        />
      </div>
    );
  } else if (t === "dropdown") {
    control = (
      <DropdownInput
        id={id}
        label={label}
        options={field.options ?? []}
        allowOther={!!field.allowOther}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
        invalid={invalid}
        describedBy={describedBy}
        registerRef={registerRef}
      />
    );
  } else if (t === "rating") {
    const max = ratingMax(field);
    const current = typeof value === "number" ? value : 0;
    return (
      <fieldset className="flex flex-col gap-1.5" aria-invalid={invalid || undefined} aria-describedby={describedBy}>
        <legend className="mb-1.5 text-base font-medium text-ink">
          {label}
          {field.required ? <span className="ml-1 text-sm font-normal text-ink-2">(required)</span> : null}
        </legend>
        {help}
        <div className={`flex items-center gap-1 rounded-md ${invalid ? "ring-1 ring-danger-solid" : ""}`} role="radiogroup" aria-label={label}>
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              ref={n === 1 ? (registerRef as (el: HTMLButtonElement | null) => void) : undefined}
              type="button"
              role="radio"
              aria-checked={current === n}
              aria-label={`${n} of ${max}`}
              onClick={() => onChange(current === n && !field.required ? null : n)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onChange(Math.min(max, (current || 0) + 1)); }
                if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onChange(Math.max(1, (current || 1) - 1)); }
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-3 hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Star className={`h-5 w-5 ${n <= current ? "fill-[var(--os-warning-solid)] text-[var(--os-warning-solid)]" : ""}`} strokeWidth={1.5} aria-hidden />
            </button>
          ))}
          {current ? <span className="ml-2 text-sm text-ink-2 tabular-nums">{current} of {max}</span> : null}
        </div>
        {error}
      </fieldset>
    );
  } else if (t === "people") {
    control = abilities.pickPeople ? (
      <PeopleInput id={id} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} invalid={invalid} describedBy={describedBy} registerRef={registerRef} />
    ) : (
      <SignInLine text="to choose people from the workspace." signIn={abilities.signIn} />
    );
  } else if (t === "file") {
    control = (
      <FileInput
        id={id}
        value={Array.isArray(value) ? (value.map(readFileAnswer).filter(Boolean) as FileAnswer[]) : []}
        onChange={onChange}
        canUpload={abilities.upload}
        signIn={abilities.signIn}
        inert={abilities.inert}
        invalid={invalid}
        describedBy={describedBy}
        registerRef={registerRef}
      />
    );
  } else if (t === "select" || t === "multi_select") {
    const opts = field.options ?? [];
    const multi = t === "multi_select";
    const arr = Array.isArray(value) ? (value as string[]) : [];
    const otherVals = multi ? arr.filter((x) => !opts.includes(x)) : typeof value === "string" && value !== "" && !opts.includes(value) ? [value] : [];
    const otherOn = otherVals.length > 0;
    const otherText = (otherVals[0] ?? "").trimStart();
    return (
      <fieldset className="flex flex-col gap-1.5" aria-invalid={invalid || undefined} aria-describedby={describedBy}>
        <legend className="mb-1.5 text-base font-medium text-ink">
          {label}
          {field.required ? <span className="ml-1 text-sm font-normal text-ink-2">(required)</span> : null}
        </legend>
        {help}
        <div className={`flex flex-col rounded-md ${invalid ? "ring-1 ring-danger-solid" : ""}`}>
          {opts.length === 0 ? <p className="text-sm text-ink-2">No options yet.</p> : null}
          {opts.map((o, i) => (
            <label key={`${o}-${i}`} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-base text-ink hover:bg-hover">
              <input
                ref={i === 0 ? registerRef : undefined}
                type={multi ? "checkbox" : "radio"}
                name={`${id}-opts`}
                checked={multi ? arr.includes(o) : value === o}
                onChange={(e) => {
                  if (!multi) { onChange(o); return; }
                  onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o));
                }}
                className="h-4 w-4 accent-[var(--os-brand)]"
              />
              {o}
            </label>
          ))}
          {field.allowOther ? (
            <div className="flex min-h-9 flex-wrap items-center gap-2.5 rounded-md px-2">
              <label className="flex h-9 cursor-pointer items-center gap-2.5 text-base text-ink">
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={`${id}-opts`}
                  checked={otherOn}
                  onChange={(e) => {
                    if (!multi) { onChange(" "); return; }
                    onChange(e.target.checked ? [...arr, " "] : arr.filter((x) => opts.includes(x)));
                  }}
                  className="h-4 w-4 accent-[var(--os-brand)]"
                />
                Other
              </label>
              {otherOn ? (
                <input
                  aria-label={`${label}: other`}
                  value={otherText}
                  onChange={(e) => {
                    const v = e.target.value || " ";
                    if (!multi) onChange(v);
                    else onChange([...arr.filter((x) => opts.includes(x)), v]);
                  }}
                  placeholder="Your answer"
                  className={`${INPUT_CLS} ${border} min-w-[200px] flex-1`}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        {error}
      </fieldset>
    );
  } else if (t === "checkbox") {
    // One switch row carrying the field's OWN label (the old renderer printed
    // a hard-coded "Yes" beside an unlabelled box).
    return (
      <div className="flex flex-col gap-1.5">
        <div
          className={`flex min-h-9 items-center gap-3 rounded-md ${invalid ? "ring-1 ring-danger-solid" : ""}`}
          ref={registerRef as (el: HTMLDivElement | null) => void}
          tabIndex={-1}
        >
          <Switch checked={value === true} onChange={(next) => onChange(next)} aria-label={label} />
          <span className="text-base text-ink">
            {label}
            {field.required ? <span className="ml-1 text-sm text-ink-2">(required)</span> : null}
          </span>
        </div>
        {help}
        {error}
      </div>
    );
  } else {
    // short_text, email, url, and any type a newer builder writes that this
    // renderer does not know yet: a text box, so an answer is never blocked.
    const inputType = t === "email" ? "email" : t === "url" ? "url" : "text";
    control = (
      <input
        id={id}
        ref={registerRef}
        type={inputType}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`${INPUT_CLS} ${border}`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {labelRow}
      {help}
      {control}
      {error}
    </div>
  );
}

/* ───────────────────────────── Dropdown ───────────────────────────── */

const OTHER = "__other";

/** A single choice from a list, on the one Picker (design-system 5.6, never a
 *  native select): a 36px trigger showing the answer or "Choose one", the
 *  options (searchable past six), and "Other" with its own text box when the
 *  field allows it. The popover is an absolute child, never portalled, so it
 *  works inside the builder's drawer and on the public page alike. */
function DropdownInput({ id, label, options, allowOther, value, onChange, invalid, describedBy, registerRef }: {
  id: string;
  label: string;
  options: string[];
  allowOther: boolean;
  value: string;
  onChange: (v: unknown) => void;
  invalid: boolean;
  describedBy?: string;
  registerRef: (el: HTMLElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const isOther = value !== "" && !options.includes(value);
  const shown = isOther ? "Other" : value;
  return (
    <div className="flex flex-col gap-2">
      <span
        className="relative w-fit min-w-[240px]"
        // Outside the app shell there is no LayerStack to hear Esc.
        onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}
      >
        <button
          id={id}
          ref={registerRef as (el: HTMLButtonElement | null) => void}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-describedby={describedBy}
          className={`flex h-9 w-full min-w-[240px] items-center gap-2 rounded-md border bg-raised px-3 text-start text-base hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default disabled:opacity-60 ${invalid ? "border-danger-solid" : "border-line-strong"}`}
        >
          <span className={`min-w-0 flex-1 truncate ${shown ? "text-ink" : "text-ink-3"}`}>{shown || "Choose one"}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
        </button>
        <Picker
          open={open}
          onClose={() => setOpen(false)}
          ariaLabel={label}
          width={280}
          selected={isOther ? OTHER : value || null}
          searchPlaceholder="Search options"
          emptyLabel="No options match"
          sections={[{
            options: [
              ...options.map((o) => ({ value: o, label: o })),
              ...(allowOther ? [{ value: OTHER, label: "Other" }] : []),
            ],
          }]}
          onSelect={(v) => {
            setOpen(false);
            if (v === OTHER) onChange(isOther ? value : " ");
            else onChange(v === value ? "" : v);
          }}
        />
      </span>
      {allowOther && isOther ? (
        <input
          aria-label={`${label}: other`}
          value={value.trimStart()}
          onChange={(e) => onChange(e.target.value || " ")}
          placeholder="Your answer"
          className={`${INPUT_CLS} ${invalid ? "border-danger-solid" : "border-line-strong"}`}
        />
      ) : null}
    </div>
  );
}

/* ───────────────────────────── People ───────────────────────────── */

type PersonHit = { id: string; firstName: string | null; lastName: string | null; email?: string | null };
const personLabel = (p: PersonHit) => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Member";

/** A search box over the workspace directory with the chosen people as
 *  removable chips. Signed-in only (the renderer says so otherwise). */
function PeopleInput({ id, value, onChange, invalid, describedBy, registerRef }: {
  id: string;
  value: string[];
  onChange: (v: unknown) => void;
  invalid: boolean;
  describedBy?: string;
  registerRef: (el: HTMLElement | null) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PersonHit[] | null>(null);
  const [known, setKnown] = useState<Record<string, PersonHit>>({});
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => {
      // The whole company (the picker read), never the team-scoped directory.
      const params = new URLSearchParams({ limit: "20", includeSelf: "1" });
      if (q.trim()) params.set("q", q.trim());
      fetch(`/api/people/pick?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { people: [] }))
        .then((d) => {
          if (!alive) return;
          const rows: PersonHit[] = Array.isArray(d?.people) ? d.people : Array.isArray(d?.data?.people) ? d.data.people : [];
          setHits(rows);
          setKnown((k) => ({ ...k, ...Object.fromEntries(rows.map((p) => [p.id, p])) }));
        })
        .catch(() => { if (alive) setHits([]); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open]);
  const full = value.length >= MAX_PEOPLE_PER_ANSWER;
  return (
    <div className="relative flex flex-col gap-2">
      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((pid) => (
            <span key={pid} className="inline-flex h-7 items-center gap-1 rounded-md bg-subtle px-2 text-sm text-ink">
              {known[pid] ? personLabel(known[pid]) : "A person"}
              <button type="button" aria-label={`Remove ${known[pid] ? personLabel(known[pid]) : "person"}`} onClick={() => onChange(value.filter((x) => x !== pid))} className="text-ink-2 hover:text-ink">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {!full ? (
        <input
          id={id}
          ref={registerRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          placeholder="Search people"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={`${INPUT_CLS} ${invalid ? "border-danger-solid" : "border-line-strong"}`}
        />
      ) : null}
      {open && !full ? (
        <ul id={`${id}-list`} role="listbox" className="absolute left-0 right-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-[var(--os-shadow-pop)]">
          {hits === null ? (
            <li className="px-3 py-2"><Dots variant="pending" /></li>
          ) : hits.filter((p) => !value.includes(p.id)).length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-2">No matches</li>
          ) : hits.filter((p) => !value.includes(p.id)).map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange([...value, p.id]); setQ(""); }}
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-base text-ink hover:bg-hover"
              >
                {personLabel(p)}
                {p.email ? <span className="truncate text-sm text-ink-3">{p.email}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ───────────────────────────── File upload ───────────────────────────── */

/** Pick or drop files; each one goes to the workspace's upload store the
 *  moment it is chosen, so Submit only sends the links. A failed upload says
 *  so beside the file and never blocks the rest of the form. */
function FileInput({ id, value, onChange, canUpload, signIn, inert, invalid, describedBy, registerRef }: {
  id: string;
  value: FileAnswer[];
  onChange: (v: unknown) => void;
  canUpload: boolean;
  signIn?: RendererAbilities["signIn"];
  /** The builder's preview and read-only view: the control as it looks, inert. */
  inert?: boolean;
  invalid: boolean;
  describedBy?: string;
  registerRef: (el: HTMLElement | null) => void;
}) {
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const latest = useRef(value);
  latest.current = value;

  async function take(files: FileList | null) {
    if (!files || !canUpload) return;
    setErr(null);
    const room = MAX_FILES_PER_ANSWER - latest.current.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > list.length) setErr(`Up to ${MAX_FILES_PER_ANSWER} files.`);
    for (const f of list) {
      setBusy((n) => n + 1);
      try {
        const body = new FormData();
        body.append("file", f);
        const res = await fetch("/api/upload", { method: "POST", body, credentials: "same-origin" });
        const d = await res.json().catch(() => null) as { url?: string; s3Key?: string | null; name?: string; size?: number; mimeType?: string | null; error?: string } | null;
        if (!res.ok || !d?.url) { setErr(d?.error || `We could not upload ${f.name}.`); continue; }
        const file = readFileAnswer({ name: d.name ?? f.name, url: d.url, s3Key: d.s3Key ?? null, size: d.size ?? f.size, mimeType: d.mimeType ?? f.type });
        if (file) onChange([...latest.current, file]);
      } catch {
        setErr(`We could not upload ${f.name}. Check your connection and try again.`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length ? (
        <ul className="flex flex-col gap-1">
          {value.map((f, i) => (
            <li key={`${f.url}-${i}`} className="flex h-9 items-center gap-2 rounded-md border border-line px-3 text-base text-ink">
              <Paperclip className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-ink-2 hover:text-ink">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {canUpload ? (
        value.length < MAX_FILES_PER_ANSWER ? (
          <label
            className={`flex h-9 w-fit cursor-pointer items-center gap-2 rounded-md border px-3 text-base font-medium text-ink hover:bg-hover ${invalid ? "border-danger-solid" : "border-line-strong"}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void take(e.dataTransfer.files); }}
          >
            {busy > 0 ? <Dots variant="pending" /> : <Paperclip className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />}
            {busy > 0 ? "Uploading" : "Attach files"}
            <input
              id={id}
              ref={registerRef}
              type="file"
              multiple
              className="sr-only"
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(e) => { void take(e.target.files); e.target.value = ""; }}
            />
          </label>
        ) : null
      ) : (
        inert ? (
        <span className="flex h-9 w-fit items-center gap-2 rounded-md border border-line-strong px-3 text-base font-medium text-ink-3" aria-disabled="true">
          <Paperclip className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          Attach files
        </span>
      ) : (
        <SignInLine text="to attach files." signIn={signIn} />
      )
      )}
      {err ? <p className="text-sm text-danger-text" role="alert">{err}</p> : null}
    </div>
  );
}
