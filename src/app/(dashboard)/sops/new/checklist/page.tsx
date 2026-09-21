"use client";

/* /sops/new/checklist: the checklist SOP create door (spec-process section 2). The
 * SopEditorPage with no row yet; see src/components/sops/sop-create-route.tsx. */

import { SopCreateRoute } from "@/components/sops/sop-create-route";

export default function NewSopPage() {
  return <SopCreateRoute kind="checklist" />;
}
