// The evidence pair every acknowledgement and signature is recorded with.
//
// Both `Request` and `NextRequest` carry `.headers`, so the headers are read
// off whatever object the route handler was handed. The earlier version
// gated on `req instanceof NextRequest` and fell back to an empty Headers
// object when that check failed, which under Next 16 it does for the request
// object a route handler receives, so every PolicyAcknowledgment and every
// AgreementParty signature was written with no IP and no user agent while the
// Evidence panel and the CSV export presented both as proof.

type HeaderSource = { headers?: { get(name: string): string | null } | null } | null | undefined;

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export function getRequestContext(req?: HeaderSource): RequestContext {
  const headers = req?.headers;
  if (!headers || typeof headers.get !== "function") return { ipAddress: null, userAgent: null };

  const forwarded = headers.get("x-forwarded-for");
  const ipAddress = (forwarded ? forwarded.split(",")[0]?.trim() : "")
    || headers.get("x-real-ip")?.trim()
    || null;
  const ua = headers.get("user-agent")?.trim();
  const userAgent = ua ? ua.slice(0, 512) : null;

  return { ipAddress: ipAddress || null, userAgent };
}
