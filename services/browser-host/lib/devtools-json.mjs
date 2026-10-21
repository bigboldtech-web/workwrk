// @ts-check
// One answer of Chrome's DevTools HTTP endpoint (/json/version, /json/list),
// read as JSON to at most a cap (final security review, L1). A page sets its
// own title and address, which /json/list repeats, and a Chrome that is not
// ours any more may answer anything: so the host never holds more than
// DEVTOOLS_JSON_MAX of one answer, whatever it says its length is. No
// redirect is followed, and the caller's time limit covers the body too.

/** The most of one answer read: room for a tab whose address is Chrome's longest (2 MB), and a few others. */
export const DEVTOOLS_JSON_MAX = 4 * 1024 * 1024;

/**
 * The answer at `url` as JSON. Rejects on a status that is not 2xx, a body
 * over `max`, a body that is not JSON, or the time running out.
 * @param {string} url
 * @param {{ timeoutMs: number, max?: number }} o
 * @returns {Promise<any>}
 */
export async function devtoolsJson(url, o) {
  const max = o.max ?? DEVTOOLS_JSON_MAX;
  const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(Math.max(1, o.timeoutMs)) });
  const body = r.body;
  if (!r.ok || !body) {
    await body?.cancel().catch(() => undefined);
    throw new Error("devtools_status");
  }
  const said = Number(r.headers.get("content-length"));
  if (Number.isFinite(said) && said > max) {
    await body.cancel().catch(() => undefined);
    throw new Error("devtools_too_large");
  }
  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error("devtools_too_large");
    }
    parts.push(value);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
