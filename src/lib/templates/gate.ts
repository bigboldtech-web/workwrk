// The one `templates` app-key gate, shared by every /api/template-center route.
//
// Spec: docs/plans/ui-refresh/spec-spaces-lists.md section 2 (/templates,
// "every Member (Guests never)") and access-model-spec.md section 5.2.1, whose
// APP_RULES gained the `templates` row in this phase.
//
// WHY IT IS A FILE AND NOT A LINE IN EACH ROUTE. /templates the PAGE runs
// gatePage on the `templates` key; the routes behind it ran getSessionOrFail
// alone, so the page and the API answered to different rules and a Guest could
// reach through the API what the page never draws for them. One helper means a
// new template-center route cannot ship without the gate, and none of them can
// drift apart from the page.
//
// It delegates to requireCan, so the access engine stays inert: no helper here
// flips to can().

import { AccessError, requireCan } from "@/lib/access/gate";
import { jsonError } from "@/lib/api-helpers";

/** `null` when the caller may use the Template Center; otherwise the response to return. */
export async function templatesAppGate(): Promise<Response | null> {
  try {
    await requireCan("view", { type: "app", key: "templates" });
    return null;
  } catch (e) {
    if (e instanceof AccessError) return jsonError(String(e.body.error), e.status);
    throw e;
  }
}
