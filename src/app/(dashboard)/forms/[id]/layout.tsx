// /forms/[id]: a Guest opens only a form they made (creator Full access,
// access 3.3); any other id is the in-shell 404. Everyone else passes to the
// builder, whose own reads decide edit or view only.
// See src/components/access/forms-gate.tsx.

import { FormGate } from "@/components/access/forms-gate";

export default async function FormLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FormGate formId={id}>{children}</FormGate>;
}
