// The public 404 for a SOP link (spec-process section 2): "This link is no
// longer available", no shell, no org. One sentence for an unknown token, an
// unpublished or archived SOP, or an org whose Public links toggle is off,
// so nothing about why is leaked to whoever holds a dead link.
//
// A NOTE ON THE ONE CONSOLE WARNING THIS ROUTE SHOWS IN DEV. Loading a dead
// token logs "Encountered a script tag while rendering React component",
// which no other public page does. It is the dev server injecting a <script>
// for the stylesheet this frame imports into the notFound() boundary's React
// tree. The string lives only in React DOM's *.development.js builds
// (node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js),
// which a production build never ships, so it cannot reach a customer. It is
// left alone rather than worked around, because the workaround costs the
// shared frame and buys nothing outside dev.

import { PublicPageFrame } from "@/components/process/public-page-frame";

export default function PublicSopNotFound() {
  return (
    <PublicPageFrame org={null} label="Shared SOP" footer={<>WorkwrK</>}>
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <p className="text-row text-ink">This link is no longer available</p>
        <p className="text-sm text-ink-2">It may have been turned off, or the SOP is no longer published.</p>
      </div>
    </PublicPageFrame>
  );
}
