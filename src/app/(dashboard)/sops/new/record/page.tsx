"use client";

/* Record SOP — the Scribe / click-capture flow.
 *
 * The actual capture is done by the "WorkwrK SOP Recorder" browser extension
 * (see /extension): every click is captured as a screenshot + a plain-English
 * step, then POSTed to /api/sops/record which creates the SOP. This page is the
 * setup surface AND the start trigger: the extension only begins recording when
 * this page posts the WORKWRK_APP_ORIGIN + WORKWRK_START_RECORDING handshake
 * (video screen-recording lives in Clips, not here).
 */

import { useEffect, useRef, useState } from "react";
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
    title: "Name it and hit Start recording",
    body: "Give the SOP a title below and press Start recording. A subtle dot marks each captured click, and a small “WorkwrK Recording” badge shows on every page.",
  },
  {
    Icon: MousePointerClick,
    title: "Click through your process",
    body: "Just do the task normally. Every click captures a screenshot + a readable step (“Click the Submit button”, “Type in the Email field”…). No narration needed.",
  },
  {
    Icon: CheckCircle2,
    title: "Stop — your SOP is built",
    body: "Open the extension popup and press Stop & Save. The extension creates the SOP from your captured steps and it lands in your library, ready to edit, publish, and assign.",
  },
];

type StartStatus = "idle" | "starting" | "recording" | "missing";

export default function RecordSopPage() {
  const [title, setTitle] = useState("");
  const [installed, setInstalled] = useState(false);
  const [status, setStatus] = useState<StartStatus>("idle");
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // content.js stamps <html data-workwrk-extension> and posts
    // WORKWRK_EXTENSION_INSTALLED at document_idle — check both, since this
    // component can mount before or after the content script runs. The
    // attribute check runs in a task, not the effect body: setState here
    // would re-render mid-effect (react-hooks/set-state-in-effect).
    const t = setTimeout(() => {
      if (document.documentElement.getAttribute("data-workwrk-extension") === "true") {
        setInstalled(true);
      }
    }, 0);
    function onMessage(e: MessageEvent) {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const type = (e.data as { type?: string } | null)?.type;
      if (type === "WORKWRK_EXTENSION_INSTALLED") setInstalled(true);
      if (type === "WORKWRK_RECORDING_STARTED") {
        if (ackTimer.current) clearTimeout(ackTimer.current);
        setStatus("recording");
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      clearTimeout(t);
      window.removeEventListener("message", onMessage);
      if (ackTimer.current) clearTimeout(ackTimer.current);
    };
  }, []);

  function startRecording() {
    const sopTitle = title.trim() || `Recorded SOP ${new Date().toLocaleDateString()}`;
    // Handshake the extension's content script expects: teach it our origin
    // (it validates event.origin itself), then hand over the SOP metadata.
    window.postMessage({ type: "WORKWRK_APP_ORIGIN", origin: window.location.origin }, window.location.origin);
    window.postMessage(
      { type: "WORKWRK_START_RECORDING", sop: { title: sopTitle, category: "", subcategory: "", description: "" } },
      window.location.origin,
    );
    setStatus("starting");
    if (ackTimer.current) clearTimeout(ackTimer.current);
    // No WORKWRK_RECORDING_STARTED ack → the extension isn't there (or its
    // server URL doesn't trust this origin). Show the fallback hint.
    ackTimer.current = setTimeout(() => {
      setStatus((s) => (s === "starting" ? "missing" : s));
    }, 1500);
  }

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
            <Link href="/sops/new" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[14px] text-zinc-700 hover:bg-zinc-50">
              Back
            </Link>
            <Link href="/sops" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-[14px] text-zinc-700 hover:bg-zinc-50">
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
              <p className="mt-1 text-[14px] leading-relaxed text-zinc-500">
                Instead of recording a video, the extension snaps a screenshot and writes a step for
                every click — turning a task you just <em>do</em> into a documented, screenshot-by-screenshot SOP.
              </p>
            </div>
          </div>

          <div className="mb-5 rounded-xl border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[14px] font-medium text-zinc-900">Start recording</div>
              {installed && (
                <span className="inline-flex items-center gap-1.5 text-[12px] text-zinc-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Extension detected
                </span>
              )}
            </div>
            <p className="mt-1 text-[13.5px] leading-relaxed text-zinc-500">
              Name the SOP and hit start, then click through your process. Stop from the extension popup when you&apos;re done.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="SOP title, e.g. Approve a leave request"
                className="h-9 min-w-0 flex-1 rounded-md border border-zinc-200 px-3 text-[14px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={startRecording}
                disabled={status === "recording"}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-[14px] font-medium disabled:opacity-60"
                style={{ background: "var(--os-brand)", color: "#fff" }}
              >
                <Play className="h-3.5 w-3.5" /> {status === "recording" ? "Recording…" : "Start recording"}
              </button>
            </div>
            {status === "recording" && (
              <p className="mt-2 flex items-start gap-1.5 text-[13.5px] text-emerald-600">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Recording started. Every click is being captured. Open the extension popup and press Stop &amp; Save when you&apos;re done.
              </p>
            )}
            {status === "missing" && (
              <p className="mt-2 flex items-start gap-1.5 text-[13.5px] text-amber-600">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Extension not detected. Install the WorkwrK SOP Recorder (step 1 below), reload this page, and try again.
                If it&apos;s installed, check that its Server URL setting matches this address.
              </p>
            )}
          </div>

          <ol className="space-y-3">
            {STEPS.map((s, i) => {
              const Icon = s.Icon;
              return (
                <li key={i} className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[13px] font-semibold text-zinc-600">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[14px] font-medium text-zinc-900">
                      <Icon className="h-4 w-4 text-zinc-400" /> {s.title}
                    </div>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-zinc-500">{s.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/50 px-4 py-2.5 text-[13.5px] text-zinc-600">
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
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[14px] font-medium"
              style={{ background: "var(--os-brand)", color: "#fff" }}
            >
              View recorded SOPs <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link href="/sops/new" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-[14px] text-zinc-700 hover:bg-zinc-50">
              Pick a different type
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
