"use client";

/* New SOP — type picker. Four first-class SOP kinds each route to a builder.
 * `?type=WRITTEN|CHECKLIST|RECORDED|STEPS` auto-triggers the matching card
 * (used by the sidebar "+" menu). STEPS is a UI kind: stored as
 * sopType WRITTEN with content { type: "steps", steps: [] }. */

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, ListChecks, ListOrdered, MousePointerClick, BookCopy, Sparkles, ArrowRight, ClipboardCheck, Loader2 } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type SOPKind = "WRITTEN" | "STEPS" | "CHECKLIST" | "RECORDED";

const TYPES: {
  type: SOPKind;
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
    type: "STEPS", Icon: ListOrdered,
    tile: "bg-violet-50", iconColor: "text-violet-600", dot: "bg-violet-400",
    label: "Step-by-step SOP",
    tagline: "A numbered sequence of steps with optional details and images per step.",
    bullets: ["Ordered step list", "Per-step notes + screenshots", "Reads top-to-bottom like a recipe"],
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
    tile: "bg-red-50", iconColor: "text-red-600", dot: "bg-red-400",
    label: "Click-capture SOP",
    tagline: "Click through a task — the recorder extension auto-captures a screenshot + step for each click.",
    bullets: ["Scribe-style screenshot per step", "Auto-writes the step text", "No video, no narration"],
  },
];

export default function NewSopPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [creating, setCreating] = useState<SOPKind | null>(null);
  const [hovered, setHovered] = useState<SOPKind | null>(null);
  const { toast } = useOsToast();
  // ?type= fires at most once, even across re-renders / failed creates.
  const autoFiredRef = useRef(false);

  async function pickType(type: SOPKind) {
    // Click-capture SOPs are built by the recorder extension (Scribe flow), so
    // we don't pre-create an empty SOP — just open the setup / how-to page.
    if (type === "RECORDED") {
      router.push("/sops/new/record");
      return;
    }
    setCreating(type);
    const defaultTitle = type === "WRITTEN" ? "Untitled written SOP"
      : type === "STEPS" ? "Untitled step-by-step SOP"
      : "Untitled checklist";
    const defaultContent =
      type === "WRITTEN" ? { type: "WRITTEN", body: "" }
      : type === "STEPS" ? { type: "steps", steps: [] }
      : { type: "CHECKLIST", sections: [{ title: "Steps", steps: [{ id: "s1", title: "First step" }] }] };

    try {
      const res = await fetch("/api/sops", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: defaultTitle,
          // STEPS is a presentation of WRITTEN at the DB layer.
          sopType: type === "STEPS" ? "WRITTEN" : type,
          content: defaultContent,
        }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const data = await res.json();
      const sop = data.data ?? data;
      if (type === "CHECKLIST") router.push(`/sops/new/checklist?id=${encodeURIComponent(sop.id)}`);
      else if (type === "STEPS") router.push(`/sops/${encodeURIComponent(sop.id)}?edit=1`);
      else router.push(`/sops/new/text?id=${encodeURIComponent(sop.id)}`);
    } catch {
      toast("Couldn't create SOP");
      setCreating(null);
    }
  }

  // Sidebar / menu deep-link: /sops/new?type=… skips the picker.
  useEffect(() => {
    if (autoFiredRef.current) return;
    const t = search?.get("type");
    if (t === "WRITTEN" || t === "CHECKLIST" || t === "RECORDED" || t === "STEPS") {
      autoFiredRef.current = true;
      void pickType(t);
    }
    // pickType is stable enough for a mount-style trigger; re-running on
    // search change is covered by the ref latch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

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

      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-7 text-center">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-zinc-900">How do you want to document this?</h2>
          <p className="mt-1.5 text-[13px] text-zinc-500">SOPs work four different ways. Pick the one that fits how your team will actually consume it.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {TYPES.map((t) => {
            const Icon = t.Icon;
            const busy = creating === t.type;
            return (
              <button
                key={t.type}
                type="button"
                onClick={() => pickType(t.type)}
                disabled={creating !== null}
                onMouseEnter={() => setHovered(t.type)}
                onMouseLeave={() => setHovered(null)}
                className="group"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  textAlign: "left",
                  padding: "20px",
                  borderRadius: "12px",
                  border: hovered === t.type ? "1px solid #d4d4d8" : "1px solid #e4e4e7",
                  background: "#fff",
                  boxShadow: hovered === t.type ? "0 10px 26px -14px rgba(0,0,0,0.22)" : "none",
                  transform: hovered === t.type ? "translateY(-2px)" : "none",
                  cursor: creating !== null ? "not-allowed" : "pointer",
                  opacity: creating !== null && creating !== t.type ? 0.55 : 1,
                  transition: "border-color .15s, box-shadow .15s, transform .15s",
                }}
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

        <div className="mt-5 flex items-center justify-center gap-2 rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-2.5 text-center text-[12.5px] text-zinc-600">
          <Sparkles className="h-4 w-4 shrink-0 text-[#0073EA]" />
          Need inspiration? Sidekick can draft a first version for any of these — open it after creating.
        </div>
      </div>
    </>
  );
}
