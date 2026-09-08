// Route-transition loading state for every dashboard page — shown on every
// navigation while the target page loads. Uses ValueLoader so each transition
// surfaces a company value (falls back to plain dots when none is set). Renders
// inside the OsShell canvas slot (rail + sidebar stay mounted), so the os.css
// theme catchalls apply. Do NOT use a min-h-screen full loader here — it would
// paint over the shell.

import { ValueLoader } from "@/components/brand/value-loader";

export default function Loading() {
  return (
    <div className="min-h-full flex items-center justify-center py-24">
      <ValueLoader size={40} />
    </div>
  );
}
