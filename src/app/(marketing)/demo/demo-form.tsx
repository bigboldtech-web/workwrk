"use client";

// The demo request form.
//
// It used to be `<form action="#" method="post">` with no handler: the
// browser posted to the same URL, the page reloaded, and the request was
// gone. /demo is the destination of the "Book a demo" button in the nav of
// every page on the site, so that was the second most walked path on the
// marketing site ending in nothing.
//
// The contract now, in order of importance:
//
//   1. It never says "sent" unless something received it. The endpoint
//      answers 503 when the mailer is not configured, and this form shows
//      the mailto: fallback rather than a thank-you.
//   2. There is ALWAYS a working path. Even with the API down, the fallback
//      link opens the visitor's own mail client with the same fields filled
//      in, so nobody who wants to talk to us is left with a dead button.
//   3. It says what went wrong, in words, in the form, and keeps everything
//      the visitor typed.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, TriangleAlert } from "lucide-react";
import { mailboxes } from "@/components/marketing/config";
import { CategoryTiles, categoryLabels } from "@/components/marketing/category-tiles";
import { trackFormSubmit } from "@/components/marketing/instrumentation";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string; fallback: boolean; fields: string[] };

const TEAM_SIZES = ["1 to 10", "11 to 50", "51 to 200", "201 to 500", "More than 500"];
// "Industry" used to be a select here, and it was the field the form could
// most afford to lose. marketing-concept.md section 5 names the one that
// belongs in its place: "tools you use today", as the fourteen tappable
// category tiles, the SAME component as the Stack Receipt, whose selection
// routes the request. A prospect who taps Spreadsheets, Chat and an OKR
// tool has said more in three taps than a dropdown ever asks for, and the
// sales reply can open on their stack rather than on their sector.

const SALES_MAILBOX = mailboxes.sales;

/** The placement id, on the button and on the event, exactly as a CTA's is. */
const FORM_ID = "demo-form-submit";

/**
 * The topics a page may pre-fill the message with, and the sentence each
 * one writes.
 *
 * Concept 5: "Book a demo from this page pre-fills 'Walk me through how it
 * connects'." It is a CLOSED LIST rather than the query string being copied
 * into the field, which matters for two reasons: an arbitrary string from a
 * URL in a form that is then emailed is somebody else's sentence in our
 * inbox with our page's name on it, and a typo in a link would put a
 * half-written phrase in the visitor's message with no way to tell where it
 * came from. An unknown topic pre-fills nothing.
 */
const TOPICS: Record<string, string> = {
  connections: "Walk me through how it connects.",
  pricing: "Walk me through the pricing for our team size.",
  migration: "Walk me through what moving off our current tools looks like.",
};

export function topicMessage(topic: string | undefined): string {
  if (!topic) return "";
  return TOPICS[topic] ?? "";
}

export function DemoForm({ topic }: { topic?: string } = {}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const formRef = useRef<HTMLFormElement | null>(null);
  const sentRef = useRef<HTMLDivElement | null>(null);
  const [values, setValues] = useState({
    name: "",
    email: "",
    company: "",
    size: "",
    // The category ids the visitor tapped, joined for the payload. The
    // endpoint takes a string, so the labels travel as one readable line
    // rather than as a shape the API does not know.
    tools: "",
    // Pre-filled from the page's `topic`, and editable like any other
    // field: it is a first line for the visitor, not a hidden parameter.
    notes: topicMessage(topic),
  });

  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: event.target.value }));

  // The tapped categories, as ids for the tiles and as labels for the
  // payload. Kept beside `values` rather than inside it so the request body
  // stays the flat string map the endpoint validates.
  const [toolIds, setToolIds] = useState<string[]>([]);
  const toggleTool = (id: string) => {
    const next = toolIds.includes(id) ? toolIds.filter((x) => x !== id) : [...toolIds, id];
    setToolIds(next);
    setValues((v) => ({ ...v, tools: categoryLabels(next).join(", ") }));
  };

  /** The always-works path: the same request, in the visitor's own mail client. */
  const mailtoHref = `mailto:${SALES_MAILBOX}?subject=${encodeURIComponent(
    `Demo request: ${values.company || "our team"}`,
  )}&body=${encodeURIComponent(
    [
      `Name: ${values.name}`,
      `Work email: ${values.email}`,
      `Company: ${values.company}`,
      `Team size: ${values.size || "not given"}`,
      `Tools today: ${values.tools || "not given"}`,
      "",
      values.notes || "",
    ].join("\n"),
  )}`;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "sending" });
    try {
      // The tapped categories travel at the TOP of the message rather than
      // in a field of their own, because /api/demo-request reads a fixed
      // set of keys and that route belongs to another part of the app. A
      // field the endpoint does not read is a field the sales inbox never
      // sees, so it goes where the endpoint is already looking. The
      // visitor's own sentence is kept below it, unchanged.
      const body = {
        ...values,
        notes: values.tools
          ? [`Tools today: ${values.tools}`, "", values.notes].join("\n").trim()
          : values.notes,
      };
      const response = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // The endpoint names the invalid inputs. This used to discard them,
      // so the form said "Check the highlighted fields" and highlighted
      // nothing: a screen-reader visitor heard the sentence from the alert
      // and had no way to find the field it meant.
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        fields?: unknown;
      };
      if (response.ok && data.ok) {
        setStatus({ kind: "sent" });
        trackFormSubmit(FORM_ID, "sent");
        return;
      }
      const fields = Array.isArray(data.fields) ? data.fields.filter((f): f is string => typeof f === "string") : [];
      setStatus({
        kind: "error",
        message: data.message || "Something went wrong sending the form.",
        // Anything other than a validation problem gets the fallback.
        fallback: response.status !== 422,
        fields,
      });
      trackFormSubmit(FORM_ID, "error");
      focusFirstInvalid(fields);
    } catch {
      setStatus({
        kind: "error",
        message: "We could not reach the server.",
        fallback: true,
        fields: [],
      });
      trackFormSubmit(FORM_ID, "unreachable");
    }
  }

  // Move the caret onto the confirmation the moment it replaces the form.
  useEffect(() => {
    if (status.kind === "sent") sentRef.current?.focus();
  }, [status.kind]);

  /** Puts the caret where the problem is, which is what "highlighted" has to mean. */
  function focusFirstInvalid(fields: string[]) {
    const first = fields[0];
    if (!first) return;
    const el = formRef.current?.querySelector<HTMLElement>(`[name="${CSS.escape(first)}"]`);
    el?.focus();
  }

  if (status.kind === "sent") {
    return (
      // tabIndex -1 and the focus in the effect below.
      //
      // On success the whole form is unmounted and replaced, including the
      // submit button that had focus, so focus fell to document.body: a
      // keyboard user was returned to the top of the page and a screen
      // reader user heard nothing, on the one interaction on the site that
      // has an outcome. role="status" announces the text to a screen
      // reader, but only focus moves the CARET, and the two are different
      // problems.
      <div className="p-7" role="status" tabIndex={-1} ref={sentRef}>
        <div className="flex items-center gap-2 text-slate-900">
          <CircleCheck size={18} strokeWidth={2} />
          <p className="font-bold text-base">Request sent.</p>
        </div>
        <p className="mt-2 text-base text-slate-600 leading-relaxed">
          It went to our sales inbox and we reply to {values.email}. If you do not hear back,
          write to{" "}
          <a className="text-slate-900 underline underline-offset-2" href={`mailto:${SALES_MAILBOX}`}>
            {SALES_MAILBOX}
          </a>
          .
        </p>
      </div>
    );
  }

  const sending = status.kind === "sending";
  const invalid = status.kind === "error" ? status.fields : [];

  return (
    // No `noValidate`. The browser's own constraint UI is the fastest, most
    // accessible validation on the page and it costs nothing; turning it off
    // while doing no client validation meant an empty submit made a network
    // round trip to learn what the required attributes already knew.
    <form ref={formRef} className="p-7 space-y-4" onSubmit={onSubmit}>
      {/* Honeypot. Hidden from people and from screen readers; a bot fills it. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="hidden"
        onChange={() => undefined}
      />

      <Field
        label="Full name"
        name="name"
        value={values.name}
        onChange={set("name")}
        required
        invalid={invalid.includes("name")}
      />
      <Field
        label="Work email"
        name="email"
        type="email"
        value={values.email}
        onChange={set("email")}
        required
        invalid={invalid.includes("email")}
      />
      <Field
        label="Company"
        name="company"
        value={values.company}
        onChange={set("company")}
        required
        invalid={invalid.includes("company")}
      />
      <Field label="Team size" name="size" as="select" options={TEAM_SIZES} value={values.size} onChange={set("size")} />

      <div>
        <p className="text-sm font-medium mk-ink" id="demo-tools-label">
          Tools you use today
        </p>
        <p className="mt-1 text-sm mk-ink2">
          Tap the categories you pay for. It is how we decide what to show you. Optional.
        </p>
        <div className="mt-3">
          <CategoryTiles
            selected={toolIds}
            onToggle={toggleTool}
            ariaLabel="Tools you use today"
          />
        </div>
      </div>
      <Field
        label="What do you want to see?"
        name="notes"
        as="textarea"
        value={values.notes}
        onChange={set("notes")}
        placeholder="We are evaluating WorkwrK for performance reviews and KPIs."
      />

      {status.kind === "error" ? (
        <div
          className="rounded-xl border border-slate-300 bg-slate-50 p-4 text-base text-slate-700"
          role="alert"
        >
          <p className="flex items-center gap-2 font-semibold text-slate-900">
            <TriangleAlert size={16} strokeWidth={2} />
            {status.message}
          </p>
          {status.fallback ? (
            <p className="mt-2 leading-relaxed">
              Nothing was sent. Use{" "}
              <a className="font-semibold text-slate-900 underline underline-offset-2" href={mailtoHref}>
                this pre-filled email
              </a>{" "}
              instead, or write to {SALES_MAILBOX}. Your answers are still here.
            </p>
          ) : null}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={sending}
        data-cta={FORM_ID}
        className="mk-focus w-full h-12 mt-2 rounded-lg text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition"
        style={{ background: "var(--os-brand)" }}
      >
        {sending ? "Sending" : "Request demo"} {sending ? null : <ArrowRight size={15} />}
      </button>
      <p className="text-sm text-slate-500 text-center">
        We will never share your details. Read our{" "}
        <Link href="/privacy" className="text-slate-700 underline underline-offset-2">
          privacy policy
        </Link>
        .
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  as = "input",
  options,
  required,
  value,
  onChange,
  invalid = false,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  as?: "input" | "textarea" | "select";
  options?: readonly string[];
  required?: boolean;
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  /** The endpoint said this one is the problem. */
  invalid?: boolean;
}) {
  // Tokens, and `mk-focus` for the ring. The rest of the rebuilt site draws
  // a 2px outline in the focus token on focus; this form drew a grey slate
  // ring with `focus:outline-none`, so tabbing from the nav into the form
  // silently changed what a focus indicator looks like.
  const base = "mk-focus mk-field w-full px-3.5 h-11 rounded-lg text-base transition";
  const style: React.CSSProperties = {
    background: "var(--os-surface)",
    border: `1px solid ${invalid ? "var(--os-danger-solid)" : "var(--os-line)"}`,
    color: "var(--os-ink)",
  };
  const aria = invalid ? ({ "aria-invalid": true } as const) : {};
  return (
    <label className="block">
      <span
        className="block text-sm font-semibold uppercase tracking-[0.14em] mb-1.5"
        style={{ color: "var(--os-ink-2)" }}
      >
        {label}
        {required ? <span aria-hidden> *</span> : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </span>
      {as === "textarea" ? (
        <textarea
          name={name}
          rows={4}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          className={`${base} h-auto py-3`}
          style={style}
          {...aria}
        />
      ) : as === "select" ? (
        <select name={name} className={base} value={value} onChange={onChange} style={style} {...aria}>
          <option value="">Select</option>
          {options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          name={name}
          placeholder={placeholder}
          required={required}
          value={value}
          onChange={onChange}
          className={base}
          style={style}
          {...aria}
        />
      )}
    </label>
  );
}
