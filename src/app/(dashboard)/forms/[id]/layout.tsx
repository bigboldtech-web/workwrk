// /forms/[id]: a Guest opens only a form they made (creator Full access,
// access 3.3); any other id is the in-shell 404. Everyone else passes to the
// builder, whose own reads decide edit or view only.
// See src/components/access/forms-gate.tsx.
//
// Inside that gate, decision B3: a person whose rail has no Tables hub, or
// whose org has switched off or floored the Forms app for them, is moved to
// the form's Work door before the builder mounts, keeping the query and the
// hash (src/components/access/canonical-hub-gate.tsx). FormGate stays
// outermost, so the Guest rule answers before anyone is moved anywhere.

import type { ReactNode } from "react";
import { FormGate } from "@/components/access/forms-gate";
import { CanonicalHubGate } from "@/components/access/canonical-hub-gate";

export const dynamic = "force-dynamic";

export default async function FormLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <FormGate formId={id}>
      <CanonicalHubGate kind="form" id={id}>
        {children}
      </CanonicalHubGate>
    </FormGate>
  );
}
