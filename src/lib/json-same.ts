// Two JSON values are the same value: object key order never matters (a
// Postgres jsonb column hands keys back in its own order), array order does,
// and undefined fields count as absent, as JSON.stringify drops them.

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : canonical(x)));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = canonical(x);
    }
    return out;
  }
  return v;
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
