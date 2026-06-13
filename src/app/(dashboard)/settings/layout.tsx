import { SettingsShell } from "@/components/layout/os/settings-shell";

// /settings/* renders inside the full-screen SettingsShell (OsShell steps
// aside for these routes — see os-shell.tsx).
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
