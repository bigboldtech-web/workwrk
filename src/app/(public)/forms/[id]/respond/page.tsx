"use client";

/* /forms/[id]/respond (spec-tables-forms section 2): fill in a form and send it.
 *
 * MOVED from (dashboard) to (public) at the same URL. In (dashboard) the
 * client layout sent every signed-out visitor to /login, so the link the
 * builder hands out bounced the very customer it was meant for. Here there is
 * no shell and no session requirement to READ the form: GET
 * /api/public/forms/[id] answers a live public link for anyone, or a signed-in
 * colleague who can respond on the form's anchor. Anything else is the
 * neutral invalid-link card.
 *
 *   strip   the WorkwrK four dots and wordmark; "Open in WorkwrK" at the
 *           right for a signed-in member of the form's org
 *   body    a 640 column, one bordered card: the FormRenderer
 *   send    needs a session (the decided model). A signed-out visitor goes to
 *           /login?callbackUrl=<this URL> and comes back to the same answers.
 *
 * No BackButton (no shell), no confirm dialogs, no toasts: this page sits
 * outside the dashboard's providers on purpose.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { PublicPageFrame } from "@/components/process/public-page-frame";
import { FormRenderer } from "@/components/forms/form-renderer";
import { usePublicForm, signInHref } from "@/components/forms/use-public-form";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";

export default function FormRespondPage() {
  const { id } = useParams<{ id: string }>();
  const { state, form, answers, setAnswers, submit, reload, invalidSignedIn } = usePublicForm(id, { embed: false });

  // The strip's right slot: "Open in WorkwrK" for a signed-in member, and
  // "Sign in" for a signed-out visitor (the same /login?callbackUrl= round
  // trip Submit takes, answers kept), so signing in is never only reachable
  // by pressing Submit.
  const openInApp = form?.viewer.canSubmit ? (
    <a href={`/forms/${encodeURIComponent(id)}`} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">
      Open in WorkwrK
    </a>
  ) : form && !form.viewer.signedIn ? (
    <a href={signInHref(id)} className="shrink-0 text-sm font-medium text-brand-deep hover:underline">
      Sign in
    </a>
  ) : <span />;

  const frame = (children: React.ReactNode) => (
    <PublicPageFrame org={null} brand width={640} label="" right={openInApp} footer={<>WorkwrK</>}>
      {children}
    </PublicPageFrame>
  );

  if (state === "loading") {
    return frame(
      <div className="rounded-lg border border-line bg-raised p-6 sm:p-8" aria-busy="true" aria-label="The form">
        <div className="mb-6 h-6 w-1/2 rounded bg-skeleton os-skeleton-pulse" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="mb-5 flex flex-col gap-2">
            <span className="h-3.5 w-1/3 rounded bg-skeleton os-skeleton-pulse" />
            <span className="h-9 w-full rounded-md bg-skeleton os-skeleton-pulse" />
          </div>
        ))}
      </div>,
    );
  }

  if (state === "invalid") {
    return frame(
      <div className="rounded-lg border border-line bg-raised px-6 py-12 text-center">
        <p className="text-row text-ink">This link is invalid or has been turned off.</p>
        {invalidSignedIn ? (
          // Already signed in: a sign-in would come straight back here. The
          // line is the same for every id, so it confirms nothing. The link is
          // the in-app home, not "/": "/" is the marketing landing (Log in,
          // Start free) wherever the APP_HOST redirect in proxy.ts is not set.
          <p className="mt-3 text-sm text-ink-2">
            If you expected to answer it, ask the person who sent you the link to share it with you.{" "}
            <Link href={WORK_HOME_HREF} className="font-medium text-brand-deep hover:underline">Go to WorkwrK</Link>
          </p>
        ) : (
          <a href={signInHref(id)} className="mt-3 inline-block text-sm font-medium text-brand-deep hover:underline">
            Sign in to WorkwrK
          </a>
        )}
      </div>,
    );
  }

  if (state === "error" || !form) {
    return frame(
      <div className="rounded-lg border border-line bg-raised px-6 py-12 text-center">
        <p className="text-row text-ink">We could not load this form.</p>
        <button type="button" onClick={() => void reload()} className="mt-3 text-sm font-medium text-brand-deep hover:underline">
          Retry
        </button>
      </div>,
    );
  }

  return frame(
    <FormRenderer
      form={form}
      answers={answers}
      onAnswersChange={setAnswers}
      onSubmit={submit}
      allowRedirect
      abilities={{
        pickPeople: form.viewer.canSubmit,
        upload: form.viewer.canSubmit,
        signIn: form.viewer.signedIn ? undefined : { href: signInHref(id) },
      }}
    />,
  );
}
