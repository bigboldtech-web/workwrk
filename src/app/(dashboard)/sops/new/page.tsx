"use client";

/* /sops/new: pick which kind of SOP to create.
 *
 * Spec: docs/plans/ui-refresh/spec-process.md section 2 (`/sops/new`) and
 * section 0 (one URL per kind).
 *
 * ONE CHOOSER, NOT TWO. This page and the Docs "+" modal used to be different
 * choosers for the same decision: four cards here with their own labels
 * ("Written SOP", "Step-by-step SOP", "Checklist SOP", "Click-capture SOP")
 * against three in the modal, and opposite behaviour. Both read from
 * `sopKinds()` now, so there is one list of kinds, one set of labels and one
 * rule about which of them may be offered.
 *
 * WHAT THAT FIXES, concretely:
 *   · "Click-capture SOP" was a live card whatever the environment held. The
 *     Recording kind hides unless NEXT_PUBLIC_RECORDER_EXTENSION_URL is set,
 *     because with it unset there is nothing a person could install and
 *     /sops/new/record answers with developer instructions. It shows as a
 *     Coming-soon row under "Show upcoming features" instead.
 *   · Picking a kind POSTed a SOP row on the click. That is where the
 *     abandoned "Untitled written SOP" rows came from. Every card is a plain
 *     link now; the kind's own URL owns the create.
 *   · The labels are the naming canon's (Written, Step-by-step, Checklist,
 *     Recording), so one destination has one name wherever it is offered.
 *
 * `?type=` is not read here: next.config.ts 308s all four forms onto the kind
 * routes before this page renders, which is what keeps every stored link,
 * bookmark and menu action landing on the right editor.
 *
 * THE CARDS ARE NOT OFFERED TO SOMEBODY WHO CANNOT CREATE.
 * `POST /api/sops` asks `sops`/`create`, which the legacy matrix withholds
 * from EMPLOYEE and AGENT (src/lib/permissions.ts). Until the access step
 * grants "every Member may create an unfiled SOP" (spec-process section 1 row
 * `/sops/new/*` and section 2), a viewer without that capability who typed
 * this URL got three live cards, every one of which ended on a refusal one
 * navigation later. The chooser asks the same question the route answers,
 * so the denial arrives at the door instead of behind it, and the page holds
 * no control the viewer cannot use. The denial is the in-shell 404 (spec-
 * process section 1, shape 1): New SOP is not offered to this viewer, so the
 * URL is not discoverable, and LockedPage is not a shape this unit renders.
 */

import { OsPageHeader } from "@/components/layout/os/page-header";
import { NotFoundView } from "@/components/access/not-found-view";
import { SopKindCards } from "@/components/sops/sop-kind-chooser";
import { useRole } from "@/hooks/use-role";

export default function NewSopPage() {
  // `canManageSOPs` is `can("sops", "create")`, the exact question POST
  // /api/sops answers, and while the matrix is still loading it falls back to
  // the manager tier, so the cards never flash for somebody about to be
  // refused. It is the same hook /sops uses for its own "New SOP" primary.
  const { canManageSOPs } = useRole();

  // No create right: the in-shell 404 (spec-process section 1, denial shape
  // 1). New SOP is not offered to this viewer anywhere, so the URL is not
  // discoverable, and there is no object a Request access could ask for.
  if (!canManageSOPs) return <NotFoundView />;

  return (
    <>
      <OsPageHeader title="New SOP" back={{ fallbackHref: "/sops", label: "SOPs" }} />
      <div className="os-chrome mx-auto w-full max-w-[720px] px-6 pb-12 pt-2">
        <p className="mb-4 text-base text-ink-2">How do you want to document this?</p>
        <SopKindCards />
      </div>
    </>
  );
}
