// The read-only banner on a Workspace settings page (spec-settings-workspace
// 1.4, access 5.4): one 36px brand-soft line under the page header for a
// viewer who may look but not change. Every control is replaced by its value
// as text; this line says why.
import { Info } from "lucide-react";

export function SettingsReadOnlyBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div role="note" className="flex min-h-9 items-center gap-2 rounded-md bg-brand-soft px-3 py-1.5 text-sm text-ink">
      <Info className="h-4 w-4 shrink-0 text-brand-deep" strokeWidth={1.5} aria-hidden />
      <span>{children ?? "You can look and keep people information up to date. Ask an Owner or Admin to change settings."}</span>
    </div>
  );
}
