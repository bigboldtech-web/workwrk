import { SettingsShell } from "@/components/layout/os/settings-shell";

// /settings/* renders inside the full-screen SettingsShell as the Workspace
// door (OsShell steps aside for these routes; see os-shell.tsx). The gate is
// NOT here: a layout does not re-render on client navigation, so each page
// segment renders SettingsGate itself (src/components/settings/
// settings-gate.tsx says why in full).
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell door="workspace">{children}</SettingsShell>;
}
