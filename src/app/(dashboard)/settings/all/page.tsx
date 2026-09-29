"use client";

// Workspace settings > All settings (settings-architecture 5.17): the
// registry, grouped by page. Owners and Admins (the segment's SettingsGate).
import { SettingsPage } from "@/components/settings/settings-page";
import { AllSettingsIndex } from "@/components/settings/all-settings-index";

export default function WorkspaceAllSettingsPage() {
  return (
    <SettingsPage pageKey="all">
      <AllSettingsIndex door="workspace" allowedExternalGates={["manage_process"]} />
    </SettingsPage>
  );
}
