// A request body that is not JSON answers 400, not an empty 500 (pen test
// 2026-11-28, V-52): about 37 write routes called `await req.json()` with no
// catch, so a malformed body threw out of the handler.
//
//   const body = await req.json().catch(() => BAD_JSON);
//   if (body === BAD_JSON) return badJson();

import { NextResponse } from "next/server";

/** What a body that would not parse reads as; compared by identity. */
export const BAD_JSON: unique symbol = Symbol("bad-json");

export function badJson(): NextResponse {
  const message = "The request body is not valid JSON.";
  return NextResponse.json({ error: message, code: "invalid_json", message }, { status: 400 });
}
