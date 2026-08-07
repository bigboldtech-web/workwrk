// Route-transition loading state for every dashboard page. Renders inside
// the OsShell canvas slot (rail + sidebar stay mounted), so the os.css
// theme catchalls apply. Do NOT use DotsLoaderScreen here — its
// min-h-screen + hardcoded background would paint over the shell.

import { DotsLoader } from "@/components/brand/dots-loader";

export default function Loading() {
  return (
    <div className="min-h-full flex items-center justify-center py-24">
      <DotsLoader size={40} label="Loading" />
    </div>
  );
}
