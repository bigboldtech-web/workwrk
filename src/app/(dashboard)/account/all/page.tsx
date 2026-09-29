"use client";

// My settings > All settings (settings-architecture 4.7): the registry,
// grouped by page. Every signed-in person.
import { SettingsPage } from "@/components/settings/settings-page";
import { AllSettingsIndex } from "@/components/settings/all-settings-index";

export default function AccountAllSettingsPage() {
  return (
    <SettingsPage pageKey="account/all">
      <AllSettingsIndex door="me" />
    </SettingsPage>
  );
}
