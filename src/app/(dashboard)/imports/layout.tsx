import { SettingsShell } from "@/components/layout/os/settings-shell";

// /imports renders inside the settings takeover (spec-shell 2.8): it is the
// one SETTINGS_ROUTES member outside the two door prefixes, with the Data
// row active, until it 308s into /settings/data?tab=import.
export default function ImportsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
