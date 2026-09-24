"use client";

/* /embed/forms/[id] (spec-tables-forms section 2): the same form, with no
 * chrome, inside somebody else's page.
 *
 * It reads GET /api/public/forms/[id]?embed=1, the public-link branch only:
 * an embed never falls back to a sign-in prompt, because a host page cannot
 * be asked to carry someone else's login. It used to read the session-gated
 * GET /api/forms/[id], which is why every anonymous visitor saw "Couldn't
 * load this form: HTTP 401" even on a public form.
 *
 * The renderer is the one FormRenderer (the second FieldInput copy is gone),
 * in tokens: the purple gradient tile and the charcoal button went with it.
 * A failed send is an inline line with a way through, never alert(), and the
 * typed answers stay in the fields. The frame is never navigated to /login:
 * a send that needs a session offers the responder in a new tab, with the
 * answers handed over in the new tab's URL fragment.
 *
 * Opened as a top-level page rather than inside an iframe (a colleague who
 * was sent the old "Copy link", which handed out this URL before Phase 5, or
 * an embed snippet opened directly), an invalid answer is not the end: the
 * page replaces itself with the responder at /forms/[id]/respond, which
 * resolves the signed-in member branch and, for a signed-out visitor, offers
 * the sign-in. Inside a real iframe the public-only rule stands.
 */

import "@/app/(dashboard)/tokens.css";
import "@/app/(dashboard)/os.css";
import { useEffect } from "react";
import { useParams } from "next/navigation";
import { FormRenderer } from "@/components/forms/form-renderer";
import { respondPath, usePublicForm } from "@/components/forms/use-public-form";
import { draftHash } from "@/lib/forms/fields";

function isTopLevel(): boolean {
  try { return window.self === window.top; } catch { return false; }
}

const POWERED = (
  <p className="mt-4 text-center text-xs text-ink-3">
    <a href="https://workwrk.com" target="_blank" rel="noopener" className="hover:underline">Powered by WorkwrK</a>
  </p>
);

export default function FormEmbedPage() {
  const { id } = useParams<{ id: string }>();
  const { state, form, answers, setAnswers, submit, reload } = usePublicForm(id, { embed: true });
  const handOff = state === "invalid" && !!id && typeof window !== "undefined" && isTopLevel();

  useEffect(() => {
    if (handOff) window.location.replace(respondPath(id));
  }, [handOff, id]);

  return (
    <div className="os-chrome min-h-screen bg-app p-4 text-ink">
      {state === "loading" ? (
        <div className="mx-auto w-full max-w-[640px] rounded-lg bg-raised p-4 min-[480px]:border min-[480px]:border-line min-[480px]:p-8" aria-busy="true" aria-label="The form">
          <div className="mb-6 h-6 w-1/2 rounded bg-skeleton os-skeleton-pulse" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="mb-5 flex flex-col gap-2">
              <span className="h-3.5 w-1/3 rounded bg-skeleton os-skeleton-pulse" />
              <span className="h-9 w-full rounded-md bg-skeleton os-skeleton-pulse" />
            </div>
          ))}
        </div>
      ) : state === "invalid" && handOff ? (
        <div className="mx-auto w-full max-w-[640px] rounded-lg bg-raised px-6 py-12 text-center min-[480px]:border min-[480px]:border-line">
          <a href={respondPath(id)} className="text-sm font-medium text-brand-deep hover:underline">Open the form</a>
        </div>
      ) : state === "invalid" ? (
        <div className="mx-auto w-full max-w-[640px] rounded-lg bg-raised px-6 py-12 text-center min-[480px]:border min-[480px]:border-line">
          <p className="text-row text-ink">This link is invalid or has been turned off.</p>
        </div>
      ) : state === "error" || !form ? (
        <div className="mx-auto w-full max-w-[640px] rounded-lg bg-raised px-6 py-12 text-center min-[480px]:border min-[480px]:border-line">
          <p className="text-row text-ink">We could not load this form.</p>
          <button type="button" onClick={() => void reload()} className="mt-3 text-sm font-medium text-brand-deep hover:underline">
            Retry
          </button>
        </div>
      ) : (
        <FormRenderer
          form={form}
          answers={answers}
          onAnswersChange={setAnswers}
          onSubmit={submit}
          variant="embed"
          abilities={{
            pickPeople: form.viewer.canSubmit,
            upload: form.viewer.canSubmit,
            // Signed out: the People and File upload questions offer the same
            // new-tab round trip as Submit, carrying the answers so far.
            signIn: form.viewer.signedIn ? undefined : { href: respondPath(id) + draftHash(answers), newTab: true },
          }}
        />
      )}
      {POWERED}
    </div>
  );
}
