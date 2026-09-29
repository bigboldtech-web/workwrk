import { SettingsShell } from "@/components/layout/os/settings-shell";

// /account/* is the My settings door: every signed-in person, no role check
// (the (dashboard) layout holds the session gate).
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell door="me">{children}</SettingsShell>;
}
