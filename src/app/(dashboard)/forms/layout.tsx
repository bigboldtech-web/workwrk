// Forms belong to the Tables module (spec-shell 1.1: /forms is a tables-hub
// route), so the same gate as /tables guards this directory: with the module
// off every /forms URL renders <ModuleOff> at the same URL instead of the
// page. See src/components/access/tables-module-gate.tsx.

import { TablesModuleGate } from "@/components/access/tables-module-gate";

export default function FormsModuleLayout({ children }: { children: React.ReactNode }) {
  return <TablesModuleGate>{children}</TablesModuleGate>;
}
