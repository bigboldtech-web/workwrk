"use client";

// PublicLinksCard: access toggle 10 (access-model-spec section 8, "Public
// links") as one settings row on the Access page. Off = no new public link
// can be minted for a SOP, a task or a doc and existing links stop answering; View
// only = anyone holding a link reads the object without signing in.
//
// It exists because the share dialogs refuse a new public link while the
// toggle is off and point admins here, so there has to be a control behind
// that sentence. Reads GET /api/settings (settings.access.publicLinks) and
// writes PATCH /api/settings { section: "access", data: { publicLinks } }.
// The row autosaves with the inline "Saved" tick and reverts on failure. A
// failed save says why and offers a Retry that resends the value the admin
// picked (the chassis rule in settings-row.tsx), not a bare "Not saved".
//
// The stored key can also be ABSENT (an org that never saved this page). The
// public docs, tables and forms routes treat absent as "keep what is live"
// (lib/public-links.ts), while a SOP or task link needs an explicit View only, so an
// absent key is shown as its own honest line under the switch instead of a
// flat "Off" that the live links would contradict. Either choice then stores
// an explicit value and every reader agrees.

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Dots } from "@/components/ui/dots";
import { apiFetch } from "@/lib/api-fetch";

type PublicLinks = "off" | "view";

// What a failed save leaves behind: the reason to show and the value the
// admin picked. The switch itself reverts to the stored value, so `intended`
// is the only place the choice survives, and it is what Retry resends.
export type PublicLinksFailure = { message: string; intended: PublicLinks };

export function publicLinksFailure(r: { ok: boolean; error?: string }, intended: PublicLinks): PublicLinksFailure | null {
  if (r.ok) return null;
  return { message: r.error?.trim() || "Couldn't save", intended };
}

export function PublicLinksCard({ canEdit }: { canEdit: boolean }) {
  const [value, setValue] = useState<PublicLinks | null>(null);
  const [unset, setUnset] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [failure, setFailure] = useState<PublicLinksFailure | null>(null);

  useEffect(() => {
    let live = true;
    void apiFetch<{ settings?: { access?: { publicLinks?: PublicLinks } } }>("/api/settings", { cache: "no-store" }).then((r) => {
      if (!live) return;
      const stored = r.ok ? r.data.settings?.access?.publicLinks : undefined;
      setUnset(r.ok && stored !== "view" && stored !== "off");
      setValue(stored === "view" ? "view" : "off");
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
    setFailure(null);
    setState("saving");
    const r = await apiFetch("/api/settings", { method: "PATCH", json: { section: "access", data: { publicLinks: next } } });
    const failed = publicLinksFailure(r, next);
    if (failed) { setValue(prev); setFailure(failed); setState("failed"); return; }
    setUnset(false);
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
          <p className="text-base text-ink">Let people share SOPs, docs, tasks, tables and forms with a link that works without signing in</p>
          <p className="text-sm text-ink-2">Off turns every existing public link off as well. Signing links and run links are separate and always work.</p>
          {unset ? (
            <p className="mt-1 text-sm text-ink-2">
              Not chosen yet: docs, tables and forms already made public keep working, and new SOP and task links stay off until you choose.
            </p>
          ) : null}
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 text-sm text-ink-2">
          {state === "saving" ? <Dots variant="pending" label="Saving" /> : null}
          {state === "saved" ? <span className="text-success-text">Saved</span> : null}
          {state === "failed" && failure ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-text" role="alert">
              {failure.message}
              <button
                type="button"
                onClick={() => { void change(failure.intended === "view"); }}
                className="underline underline-offset-2 hover:text-ink"
              >
                Retry
              </button>
            </span>
          ) : null}
          {value === null ? (
            <span className="inline-block h-5 w-9 rounded-full bg-skeleton os-skeleton-pulse" aria-hidden />
          ) : canEdit ? (
            <Switch checked={value === "view"} disabled={state === "saving"} onChange={(on) => void change(on)} aria-label="Public links" />
          ) : (
            // Read-only is the value as text, never a faded control
            // (access-model-spec 5.4).
            <span className="text-base font-medium text-ink">{value === "view" ? "On" : "Off"}</span>
          )}
        </span>
      </div>
    </section>
  );
}
