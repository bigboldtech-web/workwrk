// /account/notifications is retired. Personal notification preferences (Inbox
// + Email, both stores) now live on the single merged page at
// /settings/notifications — the SettingsShell "Notifications" nav target.
// Redirect any old links there so no dead page remains (Wave 2b merge).

import { redirect } from "next/navigation";

export default function AccountNotificationsRedirect() {
  redirect("/settings/notifications");
}
