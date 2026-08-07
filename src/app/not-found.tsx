// Root 404 — catches every unmatched URL (including app typos). Clean,
// standalone light/dark page on the design system; stays a server
// component so `metadata` keeps working.

import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { GoBackButton } from "@/components/system/go-back-button";

export const metadata: Metadata = {
  title: "Not found · WorkwrK",
  description: "This page doesn't exist. Head home or jump back into the product.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-zinc-950 px-6 py-12">
      <div className="max-w-md w-full text-center">
        <div className="w-12 h-12 mx-auto rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-4">
          <SearchX className="w-6 h-6 text-zinc-500" />
        </div>
        <h1 className="text-[17px] font-semibold text-zinc-900 dark:text-zinc-100">
          Page not found
        </h1>
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
          The link may be broken, or the page may have moved.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center h-9 px-4 rounded-full bg-zinc-900 text-white text-[13px] font-medium hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Back home
          </Link>
          <GoBackButton />
        </div>
      </div>
    </div>
  );
}
