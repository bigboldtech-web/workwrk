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
