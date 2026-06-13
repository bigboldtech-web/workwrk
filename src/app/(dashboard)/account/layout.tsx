import { SettingsShell } from "@/components/layout/os/settings-shell";

// /account/* (e.g. Security) shares the settings takeover chrome so it
// reads as one "Settings" experience.
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
