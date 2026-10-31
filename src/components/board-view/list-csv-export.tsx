// ListCsvExport: the Space List tab's Export button.
//
// It used to build the CSV in the browser from the rows the page had, which
// are at most 200 (the tab's cap), so a Space of 2,000 tasks exported 200
// and said nothing. It is a link to the server export now
// (GET /api/spaces/[id]/tasks/export.csv), which reads every task the tab's
// filters match, in the tab's order, from the Lists the viewer can read.

import { Download } from "lucide-react";

interface Props {
  /** The export URL, with the tab's filters and sort (spaceTasksExportHref). */
  href: string;
  /** How many tasks match, for the tooltip and the disabled state. */
  count: number;
}

export function ListCsvExport({ href, count }: Props) {
  const className = "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50";
  if (count === 0) {
    return (
      <span className={`${className} opacity-50 cursor-not-allowed`} aria-disabled="true" title="No tasks to export">
        <Download className="w-3 h-3" />
        Export
      </span>
    );
  }
  return (
    <a href={href} download className={className} title={`Export ${count.toLocaleString("en-US")} task${count === 1 ? "" : "s"} to CSV`}>
      <Download className="w-3 h-3" />
      Export
    </a>
  );
}
