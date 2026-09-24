"use client";

// The builder title row's star (spec-tables-forms section 2 /forms/[id]): the
// form twin of TableFavoriteButton, on /api/me/favorites/forms. A failed
// write puts the star back and says so.

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useOsToast } from "@/components/layout/os/toast";

export function FormFavoriteButton({ formId }: { formId: string }) {
  const { toast } = useOsToast();
  const [starred, setStarred] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void apiFetch<{ forms?: Array<{ id: string }> }>("/api/me/favorites/forms", { cache: "no-store" }).then((r) => {
      if (alive) setStarred(r.ok ? (r.data.forms ?? []).some((f) => f.id === formId) : false);
    });
    return () => { alive = false; };
  }, [formId]);

  async function toggle() {
    if (busy || starred === null) return;
    const next = !starred;
    setStarred(next);
    setBusy(true);
    const r = await apiFetch("/api/me/favorites/forms", { method: "POST", json: { formId, on: next } });
    setBusy(false);
    if (!r.ok) { setStarred(!next); toast("Couldn't update favorites", { tone: "danger" }); return; }
    window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy || starred === null}
      aria-pressed={!!starred}
      aria-label={starred ? "Remove from favorites" : "Add to favorites"}
      title={starred ? "Remove from favorites" : "Add to favorites"}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
    >
      <Star className={`h-4 w-4 ${starred ? "fill-current text-ink" : ""}`} strokeWidth={1.5} aria-hidden />
    </button>
  );
}
