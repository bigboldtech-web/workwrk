// /forms, the list page (in a route group so this gate wraps it alone): a
// Guest gets the in-shell 404 (src/components/access/forms-gate.tsx).

import { FormsListGate } from "@/components/access/forms-gate";

export default function FormsListLayout({ children }: { children: React.ReactNode }) {
  return <FormsListGate>{children}</FormsListGate>;
}
