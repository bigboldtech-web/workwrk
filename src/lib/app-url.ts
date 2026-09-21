// Canonical product host for cross-surface links. When NEXT_PUBLIC_APP_URL is
// set (e.g. "https://app.workwrk.com"), marketing links into the product
// (login, register) point at the app subdomain; otherwise they stay relative,
// so dev and single-host deployments keep working unchanged. Pure module (no
// server deps) so client components can import it freely.
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

export function appHref(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return APP_URL ? `${APP_URL}${p}` : p;
}

/**
 * An ABSOLUTE link for something that leaves the app: an email, a calendar
 * invite, an SMS. A relative path is useless there, so this never returns one.
 *
 * Order: NEXT_PUBLIC_APP_URL (the canonical product host), then NEXTAUTH_URL
 * (what the auth layer already believes the origin is), then the dev default.
 * Reaching the dev default in a deployed environment means a signing link
 * lands on a host the recipient cannot open, and the recipient can do nothing
 * about it, so it says so in the server log rather than quietly minting one.
 */
export function absoluteUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const configured = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");
  if (configured) return `${configured}${p}`;
  if (process.env.NODE_ENV === "production") {
    console.error("[app-url] Neither NEXT_PUBLIC_APP_URL nor NEXTAUTH_URL is set; an outbound link is falling back to http://localhost:3000 and will not open for its recipient.");
  }
  return `http://localhost:3000${p}`;
}
