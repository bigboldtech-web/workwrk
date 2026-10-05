"use client";

// Marketplace (/store, spec-tools-misc 2.5): everything WorkwrK can add to a
// workspace, and the switch that turns each part on.
//
// The inventory is REAL: every row of the module registry (src/lib/modules.ts,
// today Talk and Tables) with this workspace's state from GET /api/products,
// plus link cards to the neighbouring AI rows (Agents, Build apps,
// Integrations). What went: the fixture
// catalogue (getAllModules, which listed CRM, Helpdesk, ITSM, Legal,
// Financials, Procurement and Marketing, all out of scope), the constant
// INSTALLED set behind the "N apps installed" count, the 13 category buttons
// and their gradients, FEATURED_INTEGRATIONS (connectors live on
// /integrations only), the "50+ integrations supported" hero, and the Install
// buttons that had no onClick. The word "install" is gone: a module is turned
// on or off.
//
// "Suggest an app" is the page's one primary, for every Member.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, Hammer, Plug, Plus } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useOsShell } from "@/components/layout/os/shell-context";
import { ModuleCard } from "@/components/modules/module-card";
import { ViewTab } from "@/components/ui/view-tabs";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-fetch";
import { MODULES } from "@/lib/modules";
import { appAudienceAllows } from "@/lib/nav/app-audience";

type Product = { slug: string; tier: string; installation: { status: string } | null; needsUpgrade?: boolean };
type Tab = "all" | "on" | "off";

export default function MarketplacePage() {
  const { boot } = useBoot();
  const { toast } = useOsToast();
  const { askAiVisible } = useOsShell();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [plan, setPlan] = useState("STARTER");
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<Tab>("all");
  const [suggestOpen, setSuggestOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch<{ products: Product[]; canManage: boolean; plan?: string }>("/api/products", { cache: "no-store" });
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    setProducts(r.data.products);
    setCanManage(r.data.canManage);
    setPlan(r.data.plan ?? "STARTER");
    setOverride({});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(t); window.removeEventListener("focus", onFocus); };
  }, [load]);

  const bySlug = useMemo(() => new Map((products ?? []).map((p) => [p.slug, p])), [products]);
  const isOn = useCallback(
    (slug: string) => override[slug] ?? bySlug.get(slug)?.installation?.status === "ACTIVE",
    [override, bySlug],
  );
  const shown = MODULES.filter((m) => (tab === "all" ? true : tab === "on" ? isOn(m.productSlug) : !isOn(m.productSlug)));
  const showBuild = appAudienceAllows("build", boot.viewer);

  return (
    <>
      <OsPageHeader
        title="Marketplace"
        views={
          <>
            <ViewTab label="All" active={tab === "all"} onClick={() => setTab("all")} />
            <ViewTab label="On" active={tab === "on"} onClick={() => setTab("on")} />
            <ViewTab label="Off" active={tab === "off"} onClick={() => setTab("off")} />
          </>
        }
        primary={{ label: "Suggest an app", icon: Plus, onClick: () => setSuggestOpen(true) }}
      />
      <div className="px-6 pb-8 pt-2">
        {error ? (
          <OsEmptyView variant="error" title="Couldn't load Marketplace" hint={error} action={{ label: "Try again", onClick: () => void load() }} />
        ) : products === null ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {shown.map((m) => (
              <ModuleCard
                key={m.appKey}
                module={m}
                on={isOn(m.productSlug)}
                canManage={canManage}
                plan={plan}
                needsUpgrade={bySlug.get(m.productSlug)?.needsUpgrade ?? false}
                onChanged={(on) => setOverride((o) => ({ ...o, [m.productSlug]: on }))}
              />
            ))}
            {tab === "all" ? (
              <>
                {/* The AI entry to Agents (spec-ai-automation /agents Entry
                    points: the Marketplace category "AI"), for anyone who
                    has Ask AI. */}
                {askAiVisible ? (
                  <LinkCard href="/agents" icon={Bot} title="Agents" blurb="AI teammates that do one job for you, on a schedule or when you ask." />
                ) : null}
                {showBuild ? (
                  <LinkCard href="/build" icon={Hammer} title="Build apps" blurb="Describe a small app of your own and WorkwrK drafts it for you." />
                ) : null}
                <LinkCard href="/integrations" icon={Plug} title="Integrations" blurb="See which of your other tools WorkwrK can talk to, and ask for the ones it can't yet." />
              </>
            ) : null}
            {shown.length === 0 && tab !== "all" ? (
              <li className="flex h-11 items-center gap-1 text-row text-ink-2">
                {tab === "on" ? "Nothing is turned on" : "Everything is on"} ·
                <button type="button" className="text-brand-deep hover:underline" onClick={() => setTab("all")}>Show all</button>
              </li>
            ) : null}
          </ul>
        )}
      </div>
      <SuggestDialog open={suggestOpen} onOpenChange={setSuggestOpen} onSent={() => toast("Thanks. We read every one of these.")} />
    </>
  );
}

function LinkCard({ href, icon: Icon, title, blurb }: { href: string; icon: typeof Plug; title: string; blurb: string }) {
  return (
    <li>
      <Link href={href} className="flex h-full flex-col gap-3 rounded-lg border border-line bg-raised p-4 hover:bg-hover">
        <span className="flex items-start gap-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-hover text-ink-2">
            <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-semibold text-ink">{title}</span>
            <span className="mt-1 block text-sm text-ink-2">{blurb}</span>
          </span>
        </span>
        <span className="mt-auto text-base font-medium text-brand-deep">Open {title}</span>
      </Link>
    </li>
  );
}

function SuggestDialog({ open, onOpenChange, onSent }: { open: boolean; onOpenChange: (v: boolean) => void; onSent: () => void }) {
  const { toast } = useOsToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (text.trim().length < 3) return;
    setBusy(true);
    const r = await apiFetch("/api/marketplace/requests", { method: "POST", json: { text: text.trim() } });
    setBusy(false);
    if (!r.ok) { toast(r.error || "Couldn't send the suggestion", { tone: "danger" }); return; }
    setText("");
    onOpenChange(false);
    onSent();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Suggest an app</DialogTitle>
          <DialogDescription>What would you want WorkwrK to do? One sentence is plenty.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={2000}
            aria-label="What would you want WorkwrK to do?"
            className="rounded-md border border-line-strong bg-raised px-3 py-2 text-base text-ink"
          />
        </div>
        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void send()} disabled={busy || text.trim().length < 3} className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-50">Send</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
