// Forms is CORE (founder decision D15, 2026-09): every Member gets forms
// whether or not the spreadsheets module is on, so this directory no longer
// mounts the Tables module gate. The Guest rule (spec-tables-forms section 1
// Access) is split by route: the list 404s for a Guest ((list)/layout.tsx),
// and a form opens for a Guest only when they made it ([id]/layout.tsx). See
// src/components/access/forms-gate.tsx.

import { FormsGate } from "@/components/access/forms-gate";

export default function FormsLayout({ children }: { children: React.ReactNode }) {
  return <FormsGate>{children}</FormsGate>;
}
