"use client";

/* New SOP — type picker.
 *
 * Three first-class SOP types each route to a dedicated builder.
 * POST to /api/sops with the right sopType + content shape.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { FileText, ListChecks, Video, BookCopy, Sparkles, ArrowRight, Hash, ClipboardCheck } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type SOPType = "WRITTEN" | "CHECKLIST" | "RECORDED";

const TYPES: { type: SOPType; Icon: React.ComponentType<{ className?: string }>; hue: string; label: string; tagline: string; bullets: string[] }[] = [
  {
    type: "WRITTEN",
    Icon: FileText, hue: "var(--os-c-teal)",
    label: "Written SOP",
    tagline: "Long-form procedure with headings, lists, and rich text.",
    bullets: ["Markdown editor", "Versioned on every save", "Best for policies, runbooks, processes"],
  },
  {
    type: "CHECKLIST",
    Icon: ListChecks, hue: "var(--os-c-blue)",
    label: "Checklist SOP",
    tagline: "Discrete steps someone can run through and tick off.",
    bullets: ["Step list with optional notes", "Assignable as process runs", "Tracks completion + share link"],
  },
  {
    type: "RECORDED",
    Icon: Video, hue: "var(--os-c-pink)",
    label: "Screen-recorded SOP",
    tagline: "Capture screen + audio while doing the thing — fastest way to show, not tell.",
    bullets: ["Browser-native screen capture", "Saves video you can share", "Pair with extension for annotated steps"],
  },
];

export default function NewSopPage() {
  const router = useRouter();
  const [creating, setCreating] = useState<SOPType | null>(null);
  const { toast } = useOsToast();

  async function pickType(type: SOPType) {
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
      if (type === "RECORDED") router.push(`/sops/new/record?id=${encodeURIComponent(sop.id)}`);
      else if (type === "CHECKLIST") router.push(`/sops/new/checklist?id=${encodeURIComponent(sop.id)}`);
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
        Icon={BookCopy}
        iconGradient={GRAD.tealGreen}
        description="Pick how you want to document this process"
        actions={
          <div className="snew__head-actions">
            <Link href="/sops" className="snew__nav-link"><Hash /> All SOPs</Link>
            <Link href="/sops/my-sops" className="snew__nav-link"><ClipboardCheck /> My SOPs</Link>
          </div>
        }
      />

      <div className="snew">
        <section className="snew__intro">
          <h2>How do you want to document this?</h2>
          <p>SOPs work three different ways. Pick the one that fits how your team will actually consume it.</p>
        </section>

        <div className="snew__cards">
          {TYPES.map((t) => {
            const Icon = t.Icon;
            return (
              <button
                key={t.type}
                type="button"
                className={`snew__card${creating === t.type ? " is-busy" : ""}`}
                onClick={() => pickType(t.type)}
                disabled={creating !== null}
                style={{ ["--card-hue" as unknown as string]: t.hue }}
              >
                <span className="snew__card-accent" aria-hidden="true" />
                <div className="snew__card-icon"><Icon /></div>
                <div className="snew__card-body">
                  <h3>{t.label}</h3>
                  <p>{t.tagline}</p>
                  <ul>
                    {t.bullets.map((b) => <li key={b}><span /> {b}</li>)}
                  </ul>
                </div>
                <span className="snew__card-cta">
                  {creating === t.type ? "Creating…" : <>Start <ArrowRight /></>}
                </span>
              </button>
            );
          })}
        </div>

        <footer className="snew__foot">
          <Sparkles />
          <span>Need inspiration? Sidekick can draft a first version for any of these — open it after creating.</span>
        </footer>
      </div>
    </>
  );
}
