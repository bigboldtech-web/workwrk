"use client";

/* New SOP — type picker. Three first-class SOP types each route to a builder. */

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { FileText, ListChecks, MousePointerClick, BookCopy, Sparkles, ArrowRight, ClipboardCheck, Loader2 } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type SOPType = "WRITTEN" | "CHECKLIST" | "RECORDED";

const TYPES: {
  type: SOPType;
  Icon: React.ComponentType<{ className?: string }>;
  tile: string; iconColor: string; dot: string;
  label: string; tagline: string; bullets: string[];
}[] = [
  {
    type: "WRITTEN", Icon: FileText,
    tile: "bg-emerald-50", iconColor: "text-emerald-600", dot: "bg-emerald-400",
    label: "Written SOP",
    tagline: "Long-form procedure with headings, lists, and rich text — reads like a note.",
    bullets: ["Notes-style block editor", "Versioned on every save", "Best for policies, runbooks, processes"],
  },
  {
    type: "CHECKLIST", Icon: ListChecks,
    tile: "bg-blue-50", iconColor: "text-blue-600", dot: "bg-blue-400",
    label: "Checklist SOP",
    tagline: "Discrete steps someone can run through and tick off.",
    bullets: ["Step list with optional notes", "Assignable as process runs", "Tracks completion + share link"],
  },
  {
    type: "RECORDED", Icon: MousePointerClick,
    tile: "bg-rose-50", iconColor: "text-rose-600", dot: "bg-rose-400",
    label: "Click-capture SOP",
    tagline: "Click through a task — the recorder extension auto-captures a screenshot + step for each click.",
    bullets: ["Scribe-style screenshot per step", "Auto-writes the step text", "No video, no narration"],
  },
];

export default function NewSopPage() {
  const router = useRouter();
  const [creating, setCreating] = useState<SOPType | null>(null);
  const { toast } = useOsToast();

  async function pickType(type: SOPType) {
    // Click-capture SOPs are built by the recorder extension (Scribe flow), so
    // we don't pre-create an empty SOP — just open the setup / how-to page.
    if (type === "RECORDED") {
      router.push("/sops/new/record");
      return;
    }
    setCreating(type);
    const defaultTitle = type === "WRITTEN" ? "Untitled written SOP"
      : type === "CHECKLIST" ? "Untitled checklist"
      : "Untitled screen recording";
    const defaultContent =
      type === "WRITTEN" ? { type: "WRITTEN", body: "# New SOP\n\nDescribe the procedure here." }
      : type === "CHECKLIST" ? { type: "CHECKLIST", sections: [{ title: "Steps", steps: [{ id: "s1", title: "First step" }] }] }
      : { type: "RECORDED", steps: [], recordings: [] };

    try {
      const res = await fetch("/api/sops", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: defaultTitle, sopType: type, content: defaultContent }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const sop = data.data ?? data;
      if (type === "CHECKLIST") router.push(`/sops/new/checklist?id=${encodeURIComponent(sop.id)}`);
      else router.push(`/sops/new/text?id=${encodeURIComponent(sop.id)}`);
    } catch {
      toast("Couldn't create SOP");
      setCreating(null);
    }
  }

  return (
    <>
      <OsTitleBar
        title="New SOP"
        showStandardActions={false}
        Icon={BookCopy}
        iconGradient={GRAD.tealGreen}
        description="Pick how you want to document this process"
        actions={
          <div className="flex items-center gap-2">
            <Link href="/sops" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">All SOPs</Link>
            <Link href="/sops/my-sops" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
              <ClipboardCheck className="h-3.5 w-3.5" /> My SOPs
            </Link>
          </div>
        }
      />

      <div className="px-6 py-6">
        <div className="mb-5">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-zinc-900">How do you want to document this?</h2>
          <p className="mt-1 text-[13px] text-zinc-500">SOPs work three different ways. Pick the one that fits how your team will actually consume it.</p>
        </div>

        <div className="grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-3">
          {TYPES.map((t) => {
            const Icon = t.Icon;
            const busy = creating === t.type;
            return (
              <button
                key={t.type}
                type="button"
                onClick={() => pickType(t.type)}
                disabled={creating !== null}
                className="group flex flex-col rounded-xl border border-zinc-200 bg-white p-5 text-left transition-all hover:border-zinc-300 hover:shadow-[0_4px_16px_-8px_rgba(0,0,0,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${t.tile}`}>
                  <Icon className={`h-5 w-5 ${t.iconColor}`} />
                </div>
                <h3 className="mt-3 text-[15px] font-semibold text-zinc-900">{t.label}</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">{t.tagline}</p>
                <ul className="mt-3 space-y-1.5">
                  {t.bullets.map((b) => (
                    <li key={b} className="flex items-center gap-2 text-[12px] text-zinc-600">
                      <span className={`h-1 w-1 shrink-0 rounded-full ${t.dot}`} /> {b}
                    </li>
                  ))}
                </ul>
                <span className="mt-auto pt-4 inline-flex items-center gap-1 text-[13px] font-medium text-zinc-900">
                  {busy ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…</>) : (<>Start <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></>)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex max-w-5xl items-center gap-2 rounded-lg border border-violet-100 bg-violet-50/50 px-4 py-2.5 text-[12.5px] text-zinc-600">
          <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
          Need inspiration? Sidekick can draft a first version for any of these — open it after creating.
        </div>
      </div>
    </>
  );
}
