"use client";

/* New SOP — type picker.
 *
 * Three first-class SOP types, each with its own creation flow:
 *   - WRITTEN     long-form text/markdown editor
 *   - CHECKLIST   step list (each step has a task title + optional notes)
 *   - RECORDED    browser screen recording (saves MP4/WebM to local
 *                 download; the steps API also exists for extension-
 *                 driven capture with annotated screenshots)
 *
 * All three POST to /api/sops with the right sopType + content shape.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText, ListChecks, Video, BookCopy, Sparkles, ArrowRight } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

type SOPType = "WRITTEN" | "CHECKLIST" | "RECORDED";

const TYPES: { type: SOPType; Icon: React.ComponentType<{ className?: string }>; hue: string; label: string; tagline: string; bullets: string[] }[] = [
  {
    type: "WRITTEN",
    Icon: FileText, hue: "var(--os-c-teal)",
    label: "Written SOP",
    tagline: "Long-form procedure with headings, lists, and rich text.",
    bullets: ["Markdown editor", "Versioned on every save", "Best for policies, processes, runbooks"],
  },
  {
    type: "CHECKLIST",
    Icon: ListChecks, hue: "var(--os-c-blue)",
    label: "Checklist SOP",
    tagline: "Discrete steps that someone can run through and tick off.",
    bullets: ["Step list with optional notes", "Assignable as process runs", "Tracks completion + share link"],
  },
  {
    type: "RECORDED",
    Icon: Video, hue: "var(--os-c-pink)",
    label: "Screen-recorded SOP",
    tagline: "Capture your screen + audio while doing the thing — fastest way to show, not tell.",
    bullets: ["Browser-native screen capture", "Saves video file you can share", "Pair with extension for annotated steps"],
  },
];

export default function NewSopPage() {
  const router = useRouter();
  const [creating, setCreating] = useState<SOPType | null>(null);
  const { toast } = useOsToast();

  async function pickType(type: SOPType) {
    setCreating(type);
    // Quick-create a draft SOP so the editor opens against a real row
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
      if (type === "RECORDED") {
        router.push(`/sops/new/record?id=${encodeURIComponent(sop.id)}`);
      } else if (type === "CHECKLIST") {
        router.push(`/sops/new/checklist?id=${encodeURIComponent(sop.id)}`);
      } else {
        router.push(`/sops/new/text?id=${encodeURIComponent(sop.id)}`);
      }
    } catch {
      toast("Couldn't create SOP");
      setCreating(null);
    }
  }

  return (
    <div className="sop-new">
      <header className="sop-new__head">
        <div className="sop-new__icon-wrap"><BookCopy /></div>
        <div>
          <h1>How do you want to document this?</h1>
          <p>SOPs work three different ways. Pick the one that fits how your team will actually consume it.</p>
        </div>
      </header>

      <div className="sop-new__cards">
        {TYPES.map((t) => (
          <button
            key={t.type}
            type="button"
            className={`sop-new__card ${creating === t.type ? "is-busy" : ""}`}
            onClick={() => pickType(t.type)}
            disabled={creating !== null}
            style={{ ["--card-hue" as string]: t.hue }}
          >
            <div className="sop-new__card-icon"><t.Icon /></div>
            <div className="sop-new__card-body">
              <h2>{t.label}</h2>
              <p>{t.tagline}</p>
              <ul>
                {t.bullets.map((b) => <li key={b}><span /> {b}</li>)}
              </ul>
              <span className="sop-new__card-cta">
                {creating === t.type ? "Creating…" : <>Start <ArrowRight /></>}
              </span>
            </div>
          </button>
        ))}
      </div>

      <footer className="sop-new__foot">
        <Sparkles />
        <span>Need inspiration? Sidekick can draft a first version for any of these — open it after creating.</span>
      </footer>
    </div>
  );
}
