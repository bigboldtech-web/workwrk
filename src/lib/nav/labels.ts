// Shell labels (naming-canon.md, spec-shell 1.3). One label per destination,
// spelled here once and imported everywhere the shell prints it: the rail,
// the breadcrumb, the palette, the menus. No screen hand-types one of these.
//
// No imports on purpose (vitest node, and route-hub.ts keeps the same rule).

import type { HubKey } from "./route-hub";

/** The eight rail hubs, exact labels, max nine characters. */
export const HUB_LABELS: Readonly<Record<HubKey, string>> = {
  home: "Work",
  planner: "Planner",
  ai: "AI",
  chat: "Talk",
  teams: "Teams",
  docs: "Docs",
  tables: "Tables",
  settings: "Settings",
};

/** Chrome labels (naming-canon 3). */
export const SHELL_LABELS = {
  search: "Search",
  searchPlaceholder: "Search or jump to…",
  settingsSearchPlaceholder: "Find a setting",
  create: "Create",
  inbox: "Inbox",
  reminders: "Reminders",
  notifications: "Notifications",
  help: "Help",
  logOut: "Log out",
  customizeSidebar: "Customize Sidebar",
  mySettings: "My settings",
  workspaceSettings: "Workspace settings",
  myProfile: "My profile",
  backToApp: "Back to app",
  switchWorkspace: "Switch workspace",
  askAi: "Ask AI",
} as const;

/**
 * The Chrome (Navy / Light) segmented control in the avatar menu and the
 * Customize panel renders only after the navy QA pass (spec-shell 1.9 and
 * 2.12, design-system 8.5 step 8). The `theme.chrome` key, the tokens and
 * `ThemeApplier` all exist already; flipping this exposes the control.
 */
export const CHROME_CONTROL_EXPOSED = false;

/** External doors the Help menu opens (spec-shell 2.13). */
export const HELP_CENTER_URL = "https://workwrk.com/help-center";
export const CHANGELOG_URL = "https://workwrk.com/changelog";
export const SUPPORT_EMAIL = "support@workwrk.com";
