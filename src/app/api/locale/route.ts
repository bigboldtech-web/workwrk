import { NextRequest, NextResponse } from "next/server";
import { BAD_JSON, badJson } from "@/lib/http/json-body";
import { isLocale } from "@/i18n/config";
import { LOCALE_COOKIE } from "@/i18n/request";

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => BAD_JSON);
  if (rawBody === BAD_JSON) return badJson();
  const { locale } = rawBody;
  if (!isLocale(locale)) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}
