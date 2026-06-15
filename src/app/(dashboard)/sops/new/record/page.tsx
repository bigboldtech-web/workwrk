"use client";

/* Record SOP — the Scribe / click-capture flow.
 *
 * The actual capture is done by the "WorkwrK SOP Recorder" browser extension
 * (see /extension): every click is captured as a screenshot + a plain-English
 * step, then POSTed to /api/sops/record which creates the SOP. This page is the
 * setup + how-to surface (video screen-recording lives in Clips, not here).
 */

import Link from "next/link";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import {
  BookCopy, MousePointerClick, Puzzle, Play, ListChecks, CheckCircle2, ArrowRight, Info,
} from "lucide-react";

const STEPS = [
  {
    Icon: Puzzle,
    title: "Install the recorder extension",
    body: "Add the “WorkwrK SOP Recorder” Chrome/Edge extension. While it's unpublished, load it unpacked: chrome://extensions → enable Developer mode → Load unpacked → pick the extension folder.",
  },
  {
    Icon: Play,
    title: "Hit Record",
    body: "Pin the extension, open the page/app you're documenting, click the extension, and press Record. A subtle dot marks each captured click.",
  },
  {
    Icon: MousePointerClick,
    title: "Click through your process",
    body: "Just do the task normally. Every click captures a screenshot + a readable step (“Click the Submit button”, “Type in the Email field”…). No narration needed.",
  },
  {
    Icon: CheckCircle2,
    title: "Stop — your SOP is built",
    body: "Press Stop. The extension creates the SOP from your captured steps and it lands in your library, ready to edit, publish, and assign.",
  },
];

export default function RecordSopPage() {
  return (
    <>
      <OsTitleBar
        title="Record a SOP"
        showStandardActions={false}
        Icon={BookCopy}
        iconGradient={GRAD.tealGreen}
        description="Capture a step-by-step SOP by clicking through your process"
        actions={
          <div className="flex items-center gap-2">
            <Link href="/sops/new" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
              Back
            </Link>
            <Link href="/sops" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50">
              <ListChecks className="h-3.5 w-3.5" /> All SOPs
            </Link>
          </div>
        }
      />

      <div className="px-6 py-6">
        <div className="max-w-3xl">
          <div className="mb-5 flex items-start gap-3">
            <div className="rounded-lg p-2.5 shrink-0" style={{ background: "var(--os-brand-soft)" }}>
              <MousePointerClick size={22} style={{ color: "var(--os-brand)" }} />
            </div>
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-zinc-900">Click-capture (Scribe-style)</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
                Instead of recording a video, the extension snaps a screenshot and writes a step for
                every click — turning a task you just <em>do</em> into a documented, screenshot-by-screenshot SOP.
              </p>
            </div>
          </div>

          <ol className="space-y-3">
            {STEPS.map((s, i) => {
              const Icon = s.Icon;
              return (
                <li key={i} className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[12px] font-semibold text-zinc-600">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[14px] font-medium text-zinc-900">
                      <Icon className="h-4 w-4 text-zinc-400" /> {s.title}
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">{s.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-2.5 text-[12.5px] text-zinc-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
            <span>
              Desktop Chrome or Edge required. The recorder works on any site (including WorkwrK) and
              learns your workspace URL automatically the first time you open the app with it installed.
              For real teams, publish the extension to the Chrome Web Store so staff can one-click install.
            </span>
          </div>

          <div className="mt-5 flex items-center gap-2">
            <Link
              href="/sops"
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium"
              style={{ background: "var(--os-brand)", color: "#fff" }}
            >
              View recorded SOPs <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link href="/sops/new" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-[13px] text-zinc-700 hover:bg-zinc-50">
              Pick a different type
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
