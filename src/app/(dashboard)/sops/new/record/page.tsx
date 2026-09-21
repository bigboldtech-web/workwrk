"use client";

/* /sops/new/record, "Record a SOP" (spec-process section 2): record a task
 * once in the browser and get a Recording SOP.
 *
 * The capture is the WorkwrK Recorder browser extension: every click becomes
 * a screenshot and a step, and the extension creates the SOP through
 * POST /api/sops/record when the person presses Stop and save. This page is
 * the start trigger (the WORKWRK_APP_ORIGIN / WORKWRK_START_RECORDING
 * handshake, origin-validated) and the status row.
 *
 * TWO STATES, BOTH HONEST:
 *   · NEXT_PUBLIC_RECORDER_EXTENSION_URL set: the form (Title, Folder), the
 *     status row ("Recorder extension detected" or "not detected" with the
 *     install link), the one blue "Start recording" only when detected and a
 *     title exists, and "How it works" in three rows. No developer copy.
 *   · Unset: the kind is absent from the chooser, but this URL stays a real
 *     route (people bookmark and paste it). It renders the same chrome and
 *     one card saying the extension is not available yet, the three "How it
 *     works" rows, and "Pick a different kind". Not a 404, not a redirect,
 *     no disabled controls.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play, Square } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { NotFoundView } from "@/components/access/not-found-view";
import { SopTaxonomyPicker } from "@/components/sops/sop-taxonomy-picker";
import { RECORDER_URL } from "@/components/sops/sop-kind-chooser";
import { useRole } from "@/hooks/use-role";

const HOW = [
  "Press Start recording and switch to the tab where you do the task.",
  "Do the task normally. Each click becomes a step with a screenshot.",
  "Press Stop and save. Your SOP opens here, ready to edit and publish.",
];

type Status = "idle" | "starting" | "recording" | "missing";

export default function RecordSopPage() {
  const router = useRouter();
  const { canManageSOPs } = useRole();
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [online, setOnline] = useState(true);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // content.js stamps <html data-workwrk-extension> and posts
    // WORKWRK_EXTENSION_INSTALLED at document_idle; check both, since this
    // component can mount before or after the content script runs.
    const t = setTimeout(() => {
      if (document.documentElement.getAttribute("data-workwrk-extension") === "true") setInstalled(true);
      setOnline(navigator.onLine);
    }, 0);
    function onMessage(e: MessageEvent) {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; sopId?: string } | null;
      if (data?.type === "WORKWRK_EXTENSION_INSTALLED") setInstalled(true);
      if (data?.type === "WORKWRK_RECORDING_STARTED") { if (ackTimer.current) clearTimeout(ackTimer.current); setStatus("recording"); }
      if (data?.type === "WORKWRK_RECORDING_SAVED" && data.sopId) router.push(`/sops/${data.sopId}?edit=1`);
    }
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("message", onMessage);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearTimeout(t);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (ackTimer.current) clearTimeout(ackTimer.current);
    };
  }, [router]);

  function startRecording() {
    const sopTitle = title.trim();
    if (!sopTitle) return;
    window.postMessage({ type: "WORKWRK_APP_ORIGIN", origin: window.location.origin }, window.location.origin);
    window.postMessage({ type: "WORKWRK_START_RECORDING", sop: { title: sopTitle, folderId, category: "", subcategory: "", description: "" } }, window.location.origin);
    setStatus("starting");
    if (ackTimer.current) clearTimeout(ackTimer.current);
    ackTimer.current = setTimeout(() => setStatus((s) => (s === "starting" ? "missing" : s)), 1500);
  }
  function stopRecording() {
    window.postMessage({ type: "WORKWRK_STOP_RECORDING" }, window.location.origin);
    setStatus("idle");
  }

  // No create right: the in-shell 404, the same shape the three sibling kind
  // routes render through SopCreateRoute (spec-process section 1, denial
  // shape 1: "LockedPage, AdminOnly and every invented variant of them are
  // not rendered by any route here"). The create doors are not offered to
  // this viewer, so the URL is not discoverable and naming it as locked would
  // tell them a thing exists that they cannot see.
  if (!canManageSOPs) return <NotFoundView />;

  const howCard = (
    <section className="rounded-lg border border-line bg-raised">
      <h2 className="flex h-9 items-center px-3 text-sm font-medium text-ink-2">How it works</h2>
      <ol className="border-t border-line-soft">
        {HOW.map((line, i) => (
          <li key={i} className="flex min-h-9 items-center gap-3 border-b border-line-soft px-3 py-2 text-base text-ink last:border-b-0">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-active text-xs font-medium tabular-nums">{i + 1}</span>
            {line}
          </li>
        ))}
      </ol>
    </section>
  );

  return (
    <>
      <Breadcrumb items={[{ label: "SOPs", href: "/sops" }, { label: "New recording" }]} />
      <OsPageHeader title="Record a SOP" back={{ fallbackHref: "/sops", label: "SOPs" }} />
      <div className="os-chrome mx-auto flex w-full max-w-[560px] flex-col gap-4 px-6 pb-12 pt-2">
        {!RECORDER_URL ? (
          <section className="rounded-lg border border-line bg-raised p-4">
            <p className="text-prose text-ink-2">Recording a SOP needs the WorkwrK Recorder browser extension, which isn&apos;t available yet.</p>
            <Link href="/sops/new" className="mt-3 inline-block text-sm font-medium text-brand-deep hover:underline">Pick a different kind</Link>
          </section>
        ) : (
          <section className="rounded-lg border border-line bg-raised">
            <h2 className="flex h-9 items-center px-3 text-sm font-medium text-ink-2">Record a SOP</h2>
            <div className="flex flex-col gap-3 border-t border-line-soft p-3">
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium text-ink-2">Title <span className="font-normal text-ink-3">(required)</span></span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && installed && title.trim() && status !== "recording") startRecording(); }}
                  placeholder="Approve a leave request"
                  disabled={status === "recording"}
                  className="h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand disabled:opacity-60"
                />
              </label>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-ink-2">Folder <span className="font-normal text-ink-3">(optional)</span></span>
                <SopTaxonomyPicker folderId={folderId} onChange={setFolderId} disabled={status === "recording"} />
              </div>
              <div className="flex min-h-12 flex-col justify-center gap-1 border-t border-line-soft pt-3">
                {!online ? (
                  <span className="inline-flex items-center gap-2 text-base text-ink-2"><span aria-hidden className="inline-block h-2 w-2 rounded-full bg-line-strong" />You&apos;re offline</span>
                ) : installed || status === "recording" ? (
                  <span className="inline-flex items-center gap-2 text-base text-ink"><span aria-hidden className="inline-block h-2 w-2 rounded-full bg-success-solid" />Recorder extension detected</span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-2 text-base text-ink"><span aria-hidden className="inline-block h-2 w-2 rounded-full bg-line-strong" />Recorder extension not detected · <a href={RECORDER_URL} target="_blank" rel="noopener" className="font-medium text-brand-deep hover:underline">Install the WorkwrK Recorder</a></span>
                    <span className="text-sm text-ink-2">After installing, reload this page.</span>
                  </>
                )}
                {status === "missing" ? <span className="text-sm text-ink-2">The extension did not answer. Check it is installed and its workspace address matches this one, then reload.</span> : null}
              </div>
              {status === "recording" ? (
                <div className="flex items-center gap-3">
                  <span className="inline-flex min-w-0 flex-1 items-center gap-2 text-base text-ink"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-brand os-saving-pulse" />Recording… every click you make is being captured</span>
                  <button type="button" onClick={stopRecording} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-line bg-raised px-3 text-base font-medium text-ink hover:bg-hover">
                    <Square className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Stop and save
                  </button>
                </div>
              ) : online && installed && title.trim() ? (
                <div>
                  <button type="button" onClick={startRecording} disabled={status === "starting"} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">
                    <Play className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Start recording
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        )}
        {howCard}
      </div>
    </>
  );
}
