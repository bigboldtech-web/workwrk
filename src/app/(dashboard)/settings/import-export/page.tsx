// Import / Export — static hub. Routes to the data-import surface and the
// audit-log export. No data fetch; navigation cards only, so this stays a
// Server Component.

import Link from "next/link";
import { Download, Upload, FileText, ChevronRight } from "lucide-react";

const SECTIONS = [
  {
    label: "Import",
    cards: [
      {
        href: "/imports",
        icon: Upload,
        title: "Import data",
        desc: "Bring in CSV data (Database, People) and more",
      },
    ],
  },
  {
    label: "Export",
    cards: [
      {
        href: "/settings/audit",
        icon: FileText,
        title: "Audit log",
        desc: "Export the signed activity log",
      },
    ],
  },
];

export default function ImportExportPage() {
  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center gap-2">
        <Download className="h-5 w-5 text-zinc-700" />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-zinc-900">Import / Export</h1>
      </header>
      <p className="mb-5 max-w-2xl text-[13px] text-zinc-500">
        Move data in and out of WorkwrK.
      </p>

      <div className="max-w-2xl space-y-6">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              {section.label}
            </div>
            <div className="space-y-2">
              {section.cards.map(({ href, icon: Icon, title, desc }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-300 hover:bg-zinc-50"
                >
                  <Icon className="h-5 w-5 shrink-0 text-zinc-500" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-zinc-900">{title}</div>
                    <div className="text-[12.5px] text-zinc-500">{desc}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="h-10" />
    </div>
  );
}
