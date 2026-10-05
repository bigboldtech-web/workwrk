"use client";

// ModuleCard (spec-tools-misc section 3 and 2.5): one premium module from the
// real registry (src/lib/modules.ts) with its real state for this workspace.
//
// Owner or Admin: a Switch that turns the module on or off through
// POST / DELETE /api/products/installations, optimistic with revert, and
// dispatches the existing workwrk:prefs-changed so the rail updates in place.
// Turning one OFF asks first, because it locks the module for everyone.
// Everyone else: a status line where the switch would be ("On", or "Off ·
// ask an admin"), never a disabled switch.
//
// The badge says which plans include it (src/lib/modules.ts): "Included in
// your plan" from Growth, "Included from Growth" on Starter. A Starter
// workspace that never had the module gets the plan instead of a switch the
// server would refuse; one that had it keeps its switch.
//
// The word "install" does not appear: a module is turned on or off.

import { useState } from "react";
import Link from "next/link";
import { MessageCircle, Table2, Boxes, type LucideIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import { MODULE_FROM_PLAN, type ModuleDef } from "@/lib/modules";

const ICON: Record<string, LucideIcon> = { chat: MessageCircle, tables: Table2 };
const OPEN_HREF: Record<string, string> = { chat: "/tlk", tables: "/tables" };
const LOCKS: Record<string, string> = {
  chat: "its channels, messages and calls",
  tables: "its tables",
};

export function ModuleCard({
  module: m,
  on,
  canManage,
  plan,
  needsUpgrade,
  onChanged,
}: {
  module: ModuleDef;
  on: boolean;
  canManage: boolean;
  /** The workspace's plan (GET /api/products). */
  plan: string;
  /** Starter and never had it: turning it on needs a plan change first. */
  needsUpgrade: boolean;
  onChanged: (on: boolean) => void;
}) {
  const confirm = useConfirm();
  const { toast } = useOsToast();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const Icon = ICON[m.appKey] ?? Boxes;

  async function flip(next: boolean) {
    if (busy) return;
    if (!next) {
      const ok = await confirm({
        title: `Turn ${m.label} off?`,
        description: `This locks ${LOCKS[m.appKey] ?? "it"} for everyone until it is turned on again. Nothing is deleted.`,
        confirmLabel: "Turn off",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    onChanged(next);
    const r = await apiFetch("/api/products/installations", { method: next ? "POST" : "DELETE", json: { productSlug: m.productSlug } });
    setBusy(false);
    if (!r.ok) {
      onChanged(!next);
      toast(r.code === "plan_required" ? r.error : `Couldn't turn ${m.label} ${next ? "on" : "off"}`, { tone: "danger" });
      return;
    }
    window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.prefsChanged, { detail: { source: "marketplace" } }));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-hover text-ink-2">
          <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">{m.label}</h3>
            <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-hover px-2 text-xs font-medium text-ink-2">
              {String(plan || "STARTER") === "STARTER" ? `Included from ${MODULE_FROM_PLAN}` : "Included in your plan"}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-ink-2">Competes with {m.competesWith}</p>
          <p className="mt-1 text-sm text-ink-2">{m.blurb}</p>
        </div>
      </div>
      <div className="mt-auto flex min-h-8 items-center gap-3">
        {needsUpgrade && !on ? (
          canManage ? (
            <span className="text-sm text-ink-2">
              On the {MODULE_FROM_PLAN} plan.{" "}
              <Link href="/settings/billing" className="font-medium text-brand-deep hover:underline">Plan &amp; billing</Link>
            </span>
          ) : (
            <span className="text-sm text-ink-2">On the {MODULE_FROM_PLAN} plan · ask an admin</span>
          )
        ) : canManage ? (
          <label className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <Switch checked={on} onChange={(v) => void flip(v)} disabled={busy} aria-label={`${m.label} ${on ? "on" : "off"}`} />
            {on ? "On" : "Off"}
            {saved ? <span className="text-xs font-medium text-success-text">Saved</span> : null}
          </label>
        ) : on ? (
          <span className="inline-flex items-center gap-2 text-sm text-ink-2"><span className="h-1.5 w-1.5 rounded-full bg-presence" aria-hidden />On</span>
        ) : (
          <span className="text-sm text-ink-2">Off · ask an admin</span>
        )}
        {on ? (
          <Link href={OPEN_HREF[m.appKey] ?? "/home"} className="ms-auto text-base font-medium text-brand-deep hover:underline">
            Open {m.label}
          </Link>
        ) : null}
      </div>
    </li>
  );
}
