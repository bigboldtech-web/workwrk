// Route gate for the Tables module (shared with /forms): see
// src/components/access/tables-module-gate.tsx.

import { TablesModuleGate } from "@/components/access/tables-module-gate";

export default function TablesModuleLayout({ children }: { children: React.ReactNode }) {
  return <TablesModuleGate>{children}</TablesModuleGate>;
}
