import { SettingsGate } from "@/components/settings/settings-gate";

// The one Workspace-settings gate, rendered by this segment (see
// src/components/settings/settings-gate.tsx for why it is per segment).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SettingsGate page="identity">{children}</SettingsGate>;
}
