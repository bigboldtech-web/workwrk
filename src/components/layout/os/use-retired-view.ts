"use client";

// useRetiredView() — the one-line client half of retired-views.ts.
//
// A page that could be reached by a retired query link calls this at the top.
// It replaces the URL at most once per retired value, because the replaced URL
// no longer matches any rule (retired-views.test.ts proves that), and it uses
// `replace` rather than `push` so the retired URL does not sit in the back
// stack waiting to be stepped into again.

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { normaliseRetiredView } from "@/lib/nav/retired-views";

export function useRetiredView(): void {
  const router = useRouter();
  const pathname = usePathname() || "";
  const params = useSearchParams();

  useEffect(() => {
    const search = params?.toString() ?? "";
    const next = normaliseRetiredView(pathname, search);
    if (next) router.replace(next);
  }, [pathname, params, router]);
}
