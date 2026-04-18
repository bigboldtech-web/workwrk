import { NextRequest, NextResponse } from "next/server";
import { isLocale } from "@/i18n/config";
import { LOCALE_COOKIE } from "@/i18n/request";

export async function POST(req: NextRequest) {
  const { locale } = await req.json();
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
