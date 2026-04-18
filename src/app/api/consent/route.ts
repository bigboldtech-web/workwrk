import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { getClientIp, getVisitorGeo, POLICY_VERSION } from "@/lib/compliance/server";

const CONSENT_COOKIE = "wwrk_consent";
const CONSENT_MAX_AGE = 60 * 60 * 24 * 180; // 6 months — GDPR/EDPB guidance

interface ConsentInput {
  necessary?: boolean;
  preferences?: boolean;
  analytics?: boolean;
  marketing?: boolean;
  doNotSell?: boolean;
  method?: string;
}

export async function GET() {
  const geo = await getVisitorGeo();
  return NextResponse.json({
    regime: geo.regime,
    country: geo.country,
    region: geo.region,
    policyVersion: POLICY_VERSION,
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ConsentInput;

  const geo = await getVisitorGeo();
  const ipAddress = await getClientIp();
  const userAgent = req.headers.get("user-agent") ?? null;

  // Derive the session if the user is logged in (optional)
  let userId: string | null = null;
  try {
    const session = (await getServerSession()) as any;
    userId = session?.user?.id ?? null;
  } catch {
    userId = null;
  }

  // Sessionless identifier — we use a random cookie token for anonymous visitors
  const cookieToken =
    req.cookies.get(CONSENT_COOKIE)?.value ?? crypto.randomUUID();

  const consent = {
    necessary: true, // always
    preferences: body.preferences === true,
    analytics: body.analytics === true,
    marketing: body.marketing === true,
    doNotSell: body.doNotSell === true,
  };

  try {
    await prisma.consentRecord.create({
      data: {
        userId,
        sessionId: cookieToken,
        necessary: consent.necessary,
        preferences: consent.preferences,
        analytics: consent.analytics,
        marketing: consent.marketing,
        doNotSell: consent.doNotSell,
        region: geo.label,
        country: geo.country,
        policyVersion: POLICY_VERSION,
        method: body.method ?? "banner",
        ipAddress,
        userAgent,
      },
    });
  } catch (err) {
    console.error("[consent] failed to persist record:", err);
    // Don't block UX — still set the cookie so the banner dismisses.
  }

  const cookieValue = JSON.stringify({
    ...consent,
    v: POLICY_VERSION,
    t: cookieToken,
    ts: Date.now(),
  });

  const res = NextResponse.json({ ok: true, consent, policyVersion: POLICY_VERSION });
  res.cookies.set(CONSENT_COOKIE, cookieValue, {
    path: "/",
    maxAge: CONSENT_MAX_AGE,
    sameSite: "lax",
    httpOnly: false, // needs to be readable client-side to gate scripts
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}

export async function DELETE(req: NextRequest) {
  // Withdraw consent — log it, reset the cookie to necessary-only.
  const geo = await getVisitorGeo();
  const ipAddress = await getClientIp();
  const userAgent = req.headers.get("user-agent") ?? null;

  let userId: string | null = null;
  try {
    const session = (await getServerSession()) as any;
    userId = session?.user?.id ?? null;
  } catch {
    userId = null;
  }

  const token = req.cookies.get(CONSENT_COOKIE)?.value;

  try {
    await prisma.consentRecord.create({
      data: {
        userId,
        sessionId: token ?? null,
        necessary: true,
        preferences: false,
        analytics: false,
        marketing: false,
        doNotSell: true,
        region: geo.label,
        country: geo.country,
        policyVersion: POLICY_VERSION,
        method: "withdrawn",
        ipAddress,
        userAgent,
        withdrawnAt: new Date(),
      },
    });
  } catch (err) {
    console.error("[consent] failed to log withdrawal:", err);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(CONSENT_COOKIE);
  return res;
}
