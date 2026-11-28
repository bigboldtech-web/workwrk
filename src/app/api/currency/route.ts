import { NextRequest, NextResponse } from "next/server";
import { BAD_JSON, badJson } from "@/lib/http/json-body";
import { isCurrency } from "@/lib/currency";
import { CURRENCY_COOKIE } from "@/lib/currency-server";

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => BAD_JSON);
  if (rawBody === BAD_JSON) return badJson();
  const { currency } = rawBody;
  if (!isCurrency(currency)) {
    return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CURRENCY_COOKIE, currency, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}
