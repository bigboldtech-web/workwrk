"use client";

// PublicLinksCard: access toggle 10 (access-model-spec section 8, "Public
// links") as one settings row on the Access page. Off = no new public link
// can be minted for a SOP or a doc and existing links stop answering; View
// only = anyone holding a link reads the object without signing in.
//
// It exists because the share dialogs refuse a new public link while the
// toggle is off and point admins here, so there has to be a control behind
// that sentence. Reads GET /api/settings (settings.access.publicLinks) and
// writes PATCH /api/settings { section: "access", data: { publicLinks } }.
// The row autosaves with the inline "Saved" tick and reverts on failure.

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Dots } from "@/components/ui/dots";
import { apiFetch } from "@/lib/api-fetch";

type PublicLinks = "off" | "view";

export function PublicLinksCard({ canEdit }: { canEdit: boolean }) {
  const [value, setValue] = useState<PublicLinks | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  useEffect(() => {
    let live = true;
    void apiFetch<{ settings?: { access?: { publicLinks?: PublicLinks } } }>("/api/settings", { cache: "no-store" }).then((r) => {
      if (!live) return;
      setValue(r.ok && r.data.settings?.access?.publicLinks === "view" ? "view" : "off");
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (state !== "saved") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  async function change(on: boolean) {
    const prev = value;
    const next: PublicLinks = on ? "view" : "off";
    setValue(next);
    setState("saving");
    const r = await apiFetch("/api/settings", { method: "PATCH", json: { section: "access", data: { publicLinks: next } } });
    if (!r.ok) { setValue(prev); setState("failed"); return; }
    setState("saved");
  }

  return (
    <section className="os-chrome rounded-lg border border-line bg-raised" aria-labelledby="public-links-heading">
      <header className="flex h-11 items-center gap-2 border-b border-line-soft px-4">
        <Globe className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />
        <h2 id="public-links-heading" className="text-row font-medium text-ink">Public links</h2>
      </header>
      <div className="flex min-h-14 items-center gap-4 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-base text-ink">Let people share SOPs and docs with a link that works without signing in</p>
          <p className="text-sm text-ink-2">Off turns every existing public link off as well. Signing links and run links are separate and always work.</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 text-sm text-ink-2">
          {state === "saving" ? <Dots variant="pending" label="Saving" /> : null}
          {state === "saved" ? <span className="text-success-text">Saved</span> : null}
          {state === "failed" ? <span className="text-danger-text">Not saved</span> : null}
          {value === null ? (
            <span className="inline-block h-5 w-9 rounded-full bg-skeleton os-skeleton-pulse" aria-hidden />
          ) : (
            <Switch checked={value === "view"} disabled={!canEdit || state === "saving"} onChange={(on) => void change(on)} aria-label="Public links" />
          )}
        </span>
      </div>
    </section>
  );
}
