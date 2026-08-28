// The honest state a module's route shows when the org hasn't turned it on.
// Rendered by the /tlk and /tables server layouts instead of the module, so a
// bookmarked URL can't bypass the Settings → Modules toggle. Server-safe (no
// client hooks) — a plain centered card with a link to the toggle.

import Link from "next/link";
import { Lock, Settings2 } from "lucide-react";

export function ModuleDisabledScreen({
  label,
  competesWith,
  blurb,
  canEnable,
}: {
  label: string;
  competesWith: string;
  blurb: string;
  /** Admins get the "Enable" link; everyone else is told to ask an admin. */
  canEnable: boolean;
}) {
  return (
    <div className="flex h-full min-h-[60vh] w-full items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border border-black/5 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div
          className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "var(--os-brand-soft)", color: "var(--os-brand)" }}
        >
          <Lock className="h-5 w-5" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {label} isn&apos;t turned on
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-zinc-500 dark:text-zinc-400">
          {label} is a premium module ({competesWith}). {blurb}
        </p>
        {canEnable ? (
          <Link
            href="/settings/modules"
            className="mt-6 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--os-brand)" }}
          >
            <Settings2 className="h-4 w-4" aria-hidden />
            Enable in Settings → Modules
          </Link>
        ) : (
          <p className="mt-6 text-[13px] text-zinc-500 dark:text-zinc-400">
            Ask a workspace admin to enable it in Settings → Modules.
          </p>
        )}
      </div>
    </div>
  );
}
