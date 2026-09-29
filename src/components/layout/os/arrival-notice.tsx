"use client";

// A one-line toast on arrival, asked for by a redirect that could not say it
// itself: `?notice=<key>`. The key is stripped from the URL as soon as the
// toast shows, so a reload or a shared link never repeats it. Only keys in
// the table say anything; an unknown key is ignored and stripped.
//
// First use: the /marketing/{id} resolver sending a campaign that was never
// moved to the Campaigns List (spec-tools-misc section 2.11 States).

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOsToast } from "@/components/layout/os/toast";

// The campaign notices say where the campaign actually is and who can bring
// it over: a Member cannot run the import, so the sentence names who can.
export const ARRIVAL_NOTICES: Record<string, string> = {
  "campaign-not-moved": "That campaign was not moved yet. An Owner or Admin can bring it over from Settings > Data.",
  "campaign-in-trash": "That campaign's task is in Trash. Restore it from Trash to open it.",
};

export function ArrivalNotice() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useOsToast();
  const shown = useRef<string | null>(null);
  const key = params.get("notice");

  useEffect(() => {
    if (!key || shown.current === key) return;
    shown.current = key;
    const message = ARRIVAL_NOTICES[key];
    if (message) toast(message);
    const next = new URLSearchParams(params.toString());
    next.delete("notice");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [key, params, pathname, router, toast]);

  return null;
}
