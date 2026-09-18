"use client";

// The on switch on ModuleOff for Owners and Admins (access-model-spec
// example K): the same control as Settings > Apps & modules, rendered where
// the person hit the wall. POST /api/products/installations, then the page
// re-renders as the module (router.refresh) and the rail re-reads its hubs.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dots } from "@/components/ui/dots";
import { useOsToast } from "@/components/layout/os/toast";

export function ModuleOffSwitch({ label, productSlug }: { label: string; productSlug: string }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [busy, setBusy] = useState(false);

  const turnOn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/products/installations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productSlug }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string })?.error ?? `Couldn't turn ${label} on`);
      }
      window.dispatchEvent(new CustomEvent("workwrk:prefs-changed"));
      toast(`${label} is on`);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : `Couldn't turn ${label} on`, { action: { label: "Try again", onClick: () => { void turnOn(); } } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => { void turnOn(); }}
      disabled={busy}
      aria-busy={busy}
      className="os-chrome inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-base font-medium text-white hover:bg-[var(--os-brand-hover)] disabled:opacity-70"
    >
      {busy ? <Dots variant="pending" /> : null}
      Turn on {label}
    </button>
  );
}
