// Duplicate a Build app (spec-tools-misc 2.3 and 2.4 row menus): read its
// fields, create a new app with the same fields and no rows, named
// "Copy of {name}" at "{slug}-copy" (a numbered suffix when that address is
// taken). Nothing on the source changes. The create is Owner and Admin, the
// same as New app, so the API answers a Member's click with the same 404
// New app would.

import { apiFetch } from "@/lib/api-fetch";

type AppField = { key: string; label: string; fieldType: string; options?: unknown };
type AppRecord = { slug: string; name: string; description: string | null; schema: { fields?: AppField[] } };

export async function duplicateBuildApp(slug: string): Promise<{ ok: true; slug: string; name: string } | { ok: false; error: string }> {
  const src = await apiFetch<{ app: AppRecord }>(`/api/build/apps/${slug}`, { cache: "no-store" });
  if (!src.ok) return { ok: false, error: src.error || "Couldn't read the app" };
  const app = src.data.app;
  const fields = (app.schema.fields ?? []).map((f) => ({ key: f.key, label: f.label, fieldType: f.fieldType, ...(f.options !== undefined ? { options: f.options } : {}) }));
  if (fields.length === 0) return { ok: false, error: "This app has no fields to copy." };
  const name = `Copy of ${app.name}`.slice(0, 80);
  const base = `${app.slug}-copy`.slice(0, 70);
  for (let n = 0; n < 20; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const r = await apiFetch<{ app: { slug: string } }>("/api/build/apps", {
      method: "POST",
      json: { name, slug: candidate, description: app.description ?? undefined, fields },
    });
    if (r.ok) return { ok: true, slug: r.data.app.slug, name };
    if (r.status !== 409) return { ok: false, error: r.error || "Couldn't duplicate the app" };
  }
  return { ok: false, error: "Couldn't find a free address for the copy." };
}
