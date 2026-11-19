// The browser tab's title for a page, as the browser will read it back.
//
// Founder report 2026-11-19: Edit details froze the tab for some people
// (Varsha Shinde, Shubham Yadav). Their names were saved with a stray space,
// and `document.title` reads back with ASCII whitespace stripped and
// collapsed (the HTML spec's title getter), so "varsha  shinde · WorkwrK"
// never equalled what was read. The shell's <head> watcher re-set it, its own
// write woke the watcher again, and that ran forever once anything else
// touched <head> (the dialog's scroll lock adds a style there).
//
// Pure: no DOM, so vitest proves it in the node environment.

/** Strip and collapse ASCII whitespace, exactly as `document.title` reads. */
export function asReadTitle(text: string): string {
  return text.replace(/[\t\n\f\r ]+/g, " ").trim();
}

/** The tab title for a page named `label`, or null when there is no name. */
export function tabTitleFor(label: string | null | undefined): string | null {
  const name = label ? asReadTitle(label) : "";
  return name ? `${name} · WorkwrK` : null;
}
