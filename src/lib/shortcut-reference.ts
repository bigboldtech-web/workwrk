// The printable reference behind My settings > Keyboard shortcuts
// (spec-account-auth `/account/shortcuts`): one table per scope, in the
// spec's order, Anywhere, Lists and boards, Inbox, Docs, Tables, Talk,
// Settings. Anywhere is the live global registry (src/lib/shortcuts.ts), so
// it lists exactly what the shell listener answers. The other scopes are
// page chords, which the live registry only holds while their page is open,
// so this file names each one next to the file that answers it, and
// shortcut-reference.test.ts reads that file and fails when the listener is
// gone. An entry can therefore never outlive its listener, and a chord is
// listed only where it is delivered on Chrome, Safari, Firefox and Edge on
// macOS and Windows (the canon in shortcuts.ts). Pure; tested.

import { SHEET_SHORTCUTS } from "@/components/tables/sheet-shortcut-list";

export interface ShortcutReferenceRow {
  /** Stable id: the registry id where the chord is a registry entry. */
  id: string;
  /** One or more chords in registry syntax; several read "1 / 2 / 3". */
  keys: readonly string[];
  label: string;
  /** The row's second line: where or when the chord works. */
  note?: string;
  /** The file that answers the chord (repo relative). */
  source: string;
  /** Text that file must contain for the chord to be live (defaults to the id). */
  proof?: string;
}

export interface ShortcutReferenceScope {
  key: "lists" | "inbox" | "docs" | "tables" | "talk" | "settings";
  name: string;
  rows: readonly ShortcutReferenceRow[];
}

const MY_WORK = "src/app/(dashboard)/my-work/my-work-client.tsx";
const INBOX = "src/app/(dashboard)/inbox/inbox-client.tsx";
const DOC = "src/components/docs/blocknote-canvas.tsx";

export const SHORTCUT_REFERENCE: readonly ShortcutReferenceScope[] = [
  {
    key: "lists",
    name: "Lists and boards",
    rows: [
      { id: "my-work-list", keys: ["1"], label: "List view", note: "On My work", source: MY_WORK },
      { id: "my-work-board", keys: ["2"], label: "Board view", note: "On My work", source: MY_WORK },
      { id: "my-work-calendar", keys: ["3"], label: "Calendar view", note: "On My work", source: MY_WORK },
      { id: "my-work-gantt", keys: ["4"], label: "Gantt view", note: "On My work", source: MY_WORK },
      { id: "my-work-timeline", keys: ["5"], label: "Timeline view", note: "On My work", source: MY_WORK },
      { id: "my-work-sprint", keys: ["6"], label: "Sprint view", note: "On My work", source: MY_WORK },
      { id: "my-work-filter", keys: ["f"], label: "Filter", note: "On My work, Everything, Favorites, Activity, Trash and Analytics", source: MY_WORK },
      { id: "my-work-clear-selection", keys: ["escape"], label: "Clear the selection", note: "While tasks are selected", source: MY_WORK },
    ],
  },
  {
    key: "inbox",
    name: "Inbox",
    rows: [
      { id: "inbox-next", keys: ["arrowdown"], label: "Next notification", source: INBOX },
      { id: "inbox-prev", keys: ["arrowup"], label: "Previous notification", source: INBOX },
      { id: "inbox-tab-1", keys: ["1", "2", "3", "4", "5"], label: "Open an Inbox tab", source: INBOX },
      { id: "inbox-clear", keys: ["e"], label: "Clear", note: "The open notification", source: INBOX },
      { id: "inbox-unread", keys: ["u"], label: "Mark unread", note: "The open notification", source: INBOX },
      { id: "inbox-snooze", keys: ["s"], label: "Snooze", note: "The open notification", source: INBOX },
      { id: "inbox-mark-all", keys: ["shift+e"], label: "Mark all read", source: INBOX },
      { id: "inbox-filter", keys: ["f"], label: "Filter", source: INBOX },
      { id: "inbox-deselect", keys: ["escape"], label: "Close the notification", source: INBOX },
    ],
  },
  {
    key: "docs",
    name: "Docs",
    rows: [
      { id: "doc.insert-block", keys: ["/"], label: "Insert a block", note: "At the start of a line or after a space", source: DOC, proof: 'triggerCharacter="/"' },
      { id: "doc.mention", keys: ["@"], label: "Mention someone", source: DOC, proof: 'triggerCharacter="@"' },
      { id: "doc.bold", keys: ["mod+b"], label: "Bold", source: DOC, proof: "useCreateBlockNote" },
      { id: "doc.italic", keys: ["mod+i"], label: "Italic", source: DOC, proof: "useCreateBlockNote" },
      { id: "doc.underline", keys: ["mod+u"], label: "Underline", source: DOC, proof: "useCreateBlockNote" },
      { id: "doc.undo", keys: ["mod+z"], label: "Undo", source: DOC, proof: "useCreateBlockNote" },
      { id: "doc.redo", keys: ["mod+shift+z"], label: "Redo", source: DOC, proof: "useCreateBlockNote" },
    ],
  },
  {
    key: "tables",
    name: "Tables",
    rows: SHEET_SHORTCUTS.map((s) => ({
      id: s.id,
      keys: [s.keys],
      label: s.label,
      source: "src/components/tables/sheet-shortcut-list.ts",
    })),
  },
  {
    key: "talk",
    name: "Talk",
    rows: [
      {
        id: "talk.search-conversation",
        keys: ["mod+f"],
        label: "Search in this conversation",
        note: "While a conversation is open",
        source: "src/components/talk/conversation-view.tsx",
      },
    ],
  },
  {
    key: "settings",
    name: "Settings",
    rows: [
      { id: "settings.find", keys: ["mod+/"], label: "Find a setting", note: "Whenever My settings or Workspace settings is open", source: "src/components/layout/os/settings-shell.tsx" },
      { id: "settings.save", keys: ["mod+s"], label: "Save changes", note: "On pages with unsaved changes", source: "src/components/settings/save-bar.tsx" },
      { id: "settings.switch-tab", keys: ["1", "2", "3"], label: "Switch tab", note: "While the tabs are focused", source: "src/components/settings/settings-page.tsx", proof: "onTabKey" },
      { id: "settings.close", keys: ["escape"], label: "Back to app", source: "src/components/layout/os/settings-shell.tsx" },
    ],
  },
];
