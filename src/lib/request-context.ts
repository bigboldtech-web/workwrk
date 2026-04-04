import { NextRequest } from "next/server";

export function getRequestContext(req?: NextRequest | Request | null) {
  if (!req) return { ipAddress: null, userAgent: null };

  const headers = req instanceof NextRequest ? req.headers : new Headers();
  const ipAddress = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || headers.get("x-real-ip")
    || null;
  const userAgent = headers.get("user-agent") || null;

  return { ipAddress, userAgent };
}
