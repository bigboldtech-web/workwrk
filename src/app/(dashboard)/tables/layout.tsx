// Route gate for the Tables module, /tables only: see
// src/components/access/tables-module-gate.tsx. /forms does not mount it
// (Forms is core, founder decision D15; forms/layout.tsx).

import { TablesModuleGate } from "@/components/access/tables-module-gate";

export default function TablesModuleLayout({ children }: { children: React.ReactNode }) {
  return <TablesModuleGate>{children}</TablesModuleGate>;
}
