// GET /api/public/forms/[id]            the responder's read (no auth required)
// GET /api/public/forms/[id]?embed=1    the embed's read (public link only)
//
// The route the product never had (spec-tables-forms section 2
// /forms/[id]/respond, Data). It answers the two branches responder-access
// resolves: a live public link (anyone), or a signed-in person who clears the
// respond check on the form's anchor. Everything else is a 404 with no body
// detail, identical for a wrong id, a form that is not public and a form that
// is not shared with you.
//
// The payload is exactly what a responder needs to render: the name, the
// description, the fields and the responder-facing settings. Never the
// destination, the mappings, the creator, the org's settings or any response.
//
// GET only: no other method is exported, so writes answer 405. The one submit
// path is POST /api/forms/[id]/responses, which requires a session unless the
// form accepts responses from people without an account (D16); then
// `requiresSignIn` is false and `viewer.anonymousSubmit` says this caller may
// send without one.

import { NextRequest, NextResponse } from "next/server";
import { resolveResponder } from "@/lib/forms/responder-access";
import { optionalResponderViewer } from "@/lib/forms/session-viewer";
import { readFormFields } from "@/lib/forms/fields";
import { acceptsAnonymousResponses, isFormClosed, readFormSettings } from "@/lib/forms/settings";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const embed = new URL(req.url).searchParams.get("embed") === "1";
  const viewer = await optionalResponderViewer();
  const decision = await resolveResponder(id, viewer, { embed });
  // `signedIn` is the same for every id (it describes the caller, not the
  // form), so the invalid card can skip offering "Sign in" to someone who is
  // already signed in without learning anything about the object.
  if (!decision) return NextResponse.json({ error: "not_found", signedIn: !!viewer }, { status: 404, headers: NO_STORE });

  const { form } = decision;
  const settings = readFormSettings(form.settings);
  return NextResponse.json(
    {
      id: form.id,
      name: form.name,
      description: form.description,
      fields: readFormFields(form.fields),
      settings: {
        acceptingResponses: settings.acceptingResponses,
        closesAt: settings.closesAt,
        closed: isFormClosed(settings),
        confirmationMessage: settings.confirmationMessage,
        redirectUrl: settings.redirectUrl,
        allowAnother: settings.allowAnother,
        collectEmail: settings.collectEmail,
        closedMessage: settings.closedMessage,
        // The decided model: sending an answer needs a session (invariant 19),
        // except on a public form whose D16 switch is on.
        requiresSignIn: !acceptsAnonymousResponses(settings, decision.branch === "public"),
      },
      viewer: {
        signedIn: decision.signedIn,
        canSubmit: decision.canSubmit,
        anonymousSubmit: decision.anonymousSubmit,
      },
    },
    { headers: NO_STORE },
  );
}
