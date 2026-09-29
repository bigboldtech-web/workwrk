// One escape for every value a person typed that goes into an email's HTML
// (first names, company names, inviter names, personal messages). Before
// this, three templates interpolated names raw, and accept-invite did not
// clean them, so a chosen first name could carry markup into an email.
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A link is only put into an href when it is http(s); anything else becomes "#". */
export function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? escapeHtml(url) : "#";
}
