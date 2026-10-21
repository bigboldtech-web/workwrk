// Reading the OAuth endpoints' bodies (docs/plans/mcp-server.md 3.3, 3.4, 3.5).
//
// The token, revocation and decision bodies are
// application/x-www-form-urlencoded, and registration's is application/json;
// a `charset` (or any other parameter) on the media type is accepted, the
// media type itself must be exact. A body is read up to its cap and no
// further, whatever Content-Length says. RFC 6749 3.1: a parameter sent more
// than once is a refused request.
//
// Pure (Web Request only).

export const FORM_MAX = 16 * 1024;
export const JSON_MAX = 16 * 1024;

/** The media type of a Content-Type header, lower case, parameters dropped. */
export function mediaType(header: string | null | undefined): string {
  return (header ?? "").split(";")[0].trim().toLowerCase();
}

export type BodyRead = { ok: true; text: string } | { ok: false; status: 400 | 413 };

/** The body as UTF-8 text, refused past `cap` bytes. */
export async function readCapped(req: Request, cap: number): Promise<BodyRead> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > cap) return { ok: false, status: 413 };
  if (!req.body) return { ok: true, text: "" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(all) };
  } catch {
    return { ok: false, status: 400 };
  }
}

export type FormRead = { ok: true; form: URLSearchParams } | { ok: false; status: 400 | 413 | 415 };

/** A form-encoded body (charset accepted), or why not. */
export async function readForm(req: Request, cap = FORM_MAX): Promise<FormRead> {
  if (mediaType(req.headers.get("content-type")) !== "application/x-www-form-urlencoded") return { ok: false, status: 415 };
  const body = await readCapped(req, cap);
  if (!body.ok) return body;
  return { ok: true, form: new URLSearchParams(body.text) };
}

export type JsonRead = { ok: true; body: unknown } | { ok: false; status: 400 | 413 | 415 };

/** A JSON body (charset accepted), or why not. */
export async function readJson(req: Request, cap = JSON_MAX): Promise<JsonRead> {
  if (mediaType(req.headers.get("content-type")) !== "application/json") return { ok: false, status: 415 };
  const body = await readCapped(req, cap);
  if (!body.ok) return body;
  try {
    return { ok: true, body: JSON.parse(body.text) };
  } catch {
    return { ok: false, status: 400 };
  }
}

/** Was any of these parameters sent more than once? */
export function anyRepeated(form: URLSearchParams, names: readonly string[]): boolean {
  return names.some((n) => form.getAll(n).length > 1);
}

/** One parameter's value, or null when absent or empty. */
export function param(form: URLSearchParams, name: string): string | null {
  const v = form.get(name);
  return v === null || v === "" ? null : v;
}
