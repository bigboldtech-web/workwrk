import "server-only";
import { headers } from "next/headers";
import { resolveRegime, regimeLabel, type ConsentRegime } from "./regions";
import { clientIpFromHeaders } from "@/lib/client-ip";

/** Current privacy-policy version. Bump whenever material terms change — all
 * users will be re-prompted to re-consent. */
export const POLICY_VERSION = "2026-10-06";

export interface VisitorGeo {
  country: string | null;
  region: string | null;
  regime: ConsentRegime;
  label: string;
}

/** Reads geo from CDN headers (Vercel, Cloudflare) with a safe fallback. */
export async function getVisitorGeo(): Promise<VisitorGeo> {
  const h = await headers();
  const country =
    h.get("x-vercel-ip-country") ??
    h.get("cf-ipcountry") ??
    h.get("x-country-code") ??
    null;
  const region =
    h.get("x-vercel-ip-country-region") ??
    h.get("cf-region-code") ??
    null;

  return {
    country,
    region,
    regime: resolveRegime(country, region),
    label: regimeLabel(country, region),
  };
}

export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  // The order a client cannot forge (src/lib/client-ip.ts). There is no CDN in
  // front of the app, so a cf-connecting-ip header could only be the client's own.
  return clientIpFromHeaders(h);
}
