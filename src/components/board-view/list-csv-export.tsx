"use client";

// ListCsvExport — small client island button that dumps the current
// filtered/sorted/grouped List view items to a CSV file. Lives in the
// Space-level List toolbar (Phase 49 lineage). The Space page already
// has the items array on the server; the button receives a serialized
// shape and triggers a blob download on click.
//
// Pure client-side — no /api/export round trip. The server filter +
// sort are already applied by the page query, so what the user sees
// is what they get in the CSV.

import { Download } from "lucide-react";

interface CsvRow {
  title: string;
  status: string;
  boardName: string;
  ownerName: string;
  updatedAt: string;
}

interface Props {
  rows: CsvRow[];
  filename: string;
}

function escapeCsv(value: string): string {
  // Quote any cell containing comma, quote, or newline; escape inner
  // quotes by doubling per RFC 4180.
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function buildCsv(rows: CsvRow[]): string {
  const header = ["Title", "Status", "Board", "Owner", "Updated"];
  const lines = [header.map(escapeCsv).join(",")];
  for (const r of rows) {
    lines.push([
      r.title,
      r.status,
      r.boardName,
      r.ownerName,
      r.updatedAt,
    ].map(escapeCsv).join(","));
  }
  return lines.join("\r\n");
}

export function ListCsvExport({ rows, filename }: Props) {
  const onClick = () => {
    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={rows.length === 0}
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
      title={rows.length === 0 ? "No items to export" : `Export ${rows.length} item${rows.length === 1 ? "" : "s"} to CSV`}
    >
      <Download className="w-3 h-3" />
      Export
    </button>
  );
}
