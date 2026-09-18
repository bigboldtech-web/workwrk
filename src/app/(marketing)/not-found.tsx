// The marketing host's 404 (spec-shell 2.5): the marketing header and footer
// come from the (marketing) layout; this is the body. One sentence, one link
// back to the landing page, nothing about the app. Reached by a notFound()
// inside the marketing group (an unknown blog slug) and, under the hard host
// split, by the proxy's rewrite of every unknown path on the marketing host
// to /404, so a typo on workwrk.com never lands in the app's frame.

import Link from "next/link";

export default function MarketingNotFound() {
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 py-24 text-center">
      <p className="m-0 text-sm font-medium uppercase tracking-wide text-slate-400">404</p>
      <h1 className="m-0 mt-3 text-2xl font-semibold text-slate-900">We couldn&apos;t find that page</h1>
      <Link href="/" className="mt-6 text-sm font-medium text-blue-600 hover:underline">
        Back to home
      </Link>
    </section>
  );
}
