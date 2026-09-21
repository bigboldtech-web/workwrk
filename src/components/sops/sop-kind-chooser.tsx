"use client";

// SopKindChooser — the "New SOP" modal behind the Docs hub "+" row.
//
// Spec: docs/plans/ui-refresh/spec-process.md section 2 (`/sops/new`, the four
// kind cards and their sentences) and section 1 (the Docs header "+").
//
// WHY A MODAL AND NOT A ROW PER KIND. Four create rows on the Docs "+" would
// make it eleven rows deep, and three of them would read almost the same. One
// row that asks the one question ("how do you want to document this?") keeps
// the menu legible and puts the four sentences where they help.
//
// WHY IT DOES NOT CREATE ANYTHING ITSELF. Each card is a plain link to the
// kind's own URL, and the URL owns the create. That is one create path per
// kind rather than two, and it means the same four destinations are reachable
// by typing, by bookmark and by the four `?type=` redirects.
//
// THE RECORDING CARD HIDES WHEN THE EXTENSION IS NOT PUBLISHED.
// `NEXT_PUBLIC_RECORDER_EXTENSION_URL` is the store listing for the recorder.
// With it unset there is nothing a person could install, and /sops/new/record
// today answers with developer instructions ("chrome://extensions, enable
// Developer mode, Load unpacked"). So the card renders as a Coming-soon row
// under the "Show upcoming features" preference instead of as a live door
// into a dead end. It is the spec's own rule, and it is why the constant is
// read here rather than in the page.

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, ListOrdered, ListChecks, MousePointerClick } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ComingSoonRow, UpcomingOnly } from "@/components/ui/coming-soon-row";

/** Set when the recorder extension has a store listing people can install. */
export const RECORDER_URL = process.env.NEXT_PUBLIC_RECORDER_EXTENSION_URL ?? "";

/** The kinds a person may actually pick right now, in the spec's order. */
export function sopKinds(): ReadonlyArray<{ href: string; icon: typeof FileText; label: string; blurb: string }> {
  return RECORDER_URL ? [...SOP_KINDS, SOP_RECORDING_KIND] : SOP_KINDS;
}

export const SOP_KINDS = [
  {
    href: "/sops/new/text",
    icon: FileText,
    label: "Written",
    blurb: "A document with headings, text and images.",
  },
  {
    href: "/sops/new/steps",
    icon: ListOrdered,
    label: "Step-by-step",
    blurb: "Numbered steps people follow in order.",
  },
  {
    href: "/sops/new/checklist",
    icon: ListChecks,
    label: "Checklist",
    blurb: "Steps people tick off, with fields to fill in. Can be run and tracked.",
  },
] as const;

export const SOP_RECORDING_KIND = {
  href: "/sops/new/record",
  icon: MousePointerClick,
  label: "Recording",
  blurb: "Do the task once in your browser; every click becomes a step with a screenshot.",
} as const;

/**
 * The kind cards themselves, shared by the modal and by the /sops/new page.
 *
 * One list, one set of labels, one rule about the Recording kind. The page
 * and the modal used to be separate choosers for the same decision and
 * disagreed on all three.
 */
export function SopKindCards({ onPick }: { onPick?: () => void }) {
  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {sopKinds().map((k) => (
          <li key={k.href}>
            <Link
              href={k.href}
              onClick={onPick}
              className="flex items-start gap-3 rounded-lg border border-line p-3 text-start hover:bg-hover"
            >
              <k.icon className="mt-0.5 h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
              <span className="min-w-0">
                <span className="block text-base font-medium text-ink">{k.label}</span>
                <span className="block text-sm text-ink-2">{k.blurb}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {RECORDER_URL ? null : (
        <UpcomingOnly>
          <div className="mt-1.5">
            <ComingSoonRow label="Recording" icon={MousePointerClick} />
          </div>
        </UpcomingOnly>
      )}
    </>
  );
}

export function SopKindChooser({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[520px]">
        <DialogTitle>New SOP</DialogTitle>
        <DialogDescription>How do you want to document this?</DialogDescription>
        <div className="mt-4">
          <SopKindCards onPick={onClose} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mounts the chooser and opens it on the Docs "+" row's event.
 *
 * The event name is the CreateAction contract from apps-catalog
 * (`workwrk:os:new:<event>`), the same mechanism "New doc" uses, so the "+"
 * needs no special case for this row.
 */
export function SopKindChooserHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("workwrk:os:new:sop-kind-chooser", onOpen);
    return () => window.removeEventListener("workwrk:os:new:sop-kind-chooser", onOpen);
  }, []);
  return <SopKindChooser open={open} onClose={() => setOpen(false)} />;
}
