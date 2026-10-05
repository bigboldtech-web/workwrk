// The random id a consent record is filed under (src/app/api/consent/route.ts):
// the "t" in the wwrk_consent cookie that route writes. Pure, server or client.
//
// WHY. The route used to take the cookie's WHOLE value as the id. On a
// re-prompt (a new POLICY_VERSION) that value is the JSON the route wrote the
// time before, so the record was filed under the previous cookie and that
// JSON went back into the new cookie as its "t": the cookie nested itself on
// every re-prompt and, after a handful, outgrew what a browser keeps (4,096
// bytes), and the privacy policy's "under the random id the wwrk_consent
// cookie holds" was false for everyone who came back. A cookie that nested
// itself still holds the first id deep inside; it is read back out, so one
// browser's records stay under one id.

const CONSENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The random id in a wwrk_consent cookie value, or null when it holds none. */
export function consentIdOf(raw: string | null | undefined): string | null {
  let value: unknown = raw;
  // A cookie stays under 4,096 bytes, which holds at most a few nestings.
  for (let depth = 0; depth < 8 && typeof value === "string"; depth++) {
    if (CONSENT_ID.test(value)) return value;
    try {
      const parsed: unknown = JSON.parse(value);
      value = parsed && typeof parsed === "object" ? (parsed as { t?: unknown }).t : null;
    } catch {
      return null;
    }
  }
  return null;
}
