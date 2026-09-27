"use client";

// Team (spec-teams-performance /reviews/[id]): everyone the viewer reviews
// or manages in this cycle, on a TableCard with the checkbox column. The
// bulk bar is Send a reminder, Ask for peer feedback and Export selected,
// never a bulk submit (a manager review is written, not batched). A row
// opens the manager review drawer at ?person={userId}; rows are links, never
// a div with a click handler. This tab also carries what the old Dashboard
// tab restated: who is not done yet is simply the rows that are not
// Completed, and the footer counts them.

import { useMemo, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Bell, Download, ExternalLink, FileText, UserPlus, UserRound } from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { TableCard, BulkAction, RowMoreButton, type TableColumn } from "@/components/ui/table-card";
import { PersonAvatar, ToneChip, personName } from "@/components/people/person-bits";
import { apiFetch } from "@/lib/api-fetch";
import { outcomeLabel, ratingsTo100, reviewStatusOf } from "@/lib/performance/review-cycle";
import type { ReviewRow } from "./cycle-types";
import { AskPeersDialog } from "./ask-peers-dialog";

function selfOf(r: ReviewRow): string {
  const v = ratingsTo100((r.selfRatings?.kraRatings ?? []).map((k) => k.rating));
  return v == null ? "" : (v / 20).toFixed(1);
}
function managerOf(r: ReviewRow): string {
  return r.managerRating == null ? "" : (r.managerRating / 20).toFixed(1);
}

export function TeamPanel({
  cycleId,
  cycleStatus,
  rows,
  viewerId,
  isAgent,
  onOpen,
  onOpenLetter,
  onChanged,
}: {
  cycleId: string;
  cycleStatus: string;
  rows: ReviewRow[];
  viewerId: string;
  isAgent: boolean;
  onOpen: (subjectId: string) => void;
  onOpenLetter: (reviewId: string) => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ row: ReviewRow; anchor: RefObject<HTMLElement | null> } | null>(null);
  const [asking, setAsking] = useState<ReviewRow[] | null>(null);
  const open = cycleStatus === "ACTIVE" || cycleStatus === "IN_CALIBRATION";
  const sorted = useMemo(() => [...rows].sort((a, b) => personName(a.subject).localeCompare(personName(b.subject))), [rows]);
  const done = rows.filter((r) => r.status === "COMPLETED").length;
  const mine = rows.filter((r) => r.reviewerId === viewerId);
  const allDone = mine.length > 0 && mine.every((r) => r.status !== "PENDING" && r.status !== "SELF_ASSESSMENT");

  const remind = async (subjectIds: string[]) => {
    const r = await apiFetch<{ notified: number }>(`/api/reviews/${cycleId}/reminders`, { method: "POST", json: { subjectIds } });
    if (!r.ok) { toast(r.error || "Couldn't send reminders", { tone: "danger" }); return; }
    toast(r.data.notified ? `Reminded ${r.data.notified} ${r.data.notified === 1 ? "person" : "people"}` : "Nobody needed a reminder");
    setSelected(new Set());
  };

  const columns: TableColumn<ReviewRow>[] = [
    {
      key: "person", label: "Person", title: true, width: "minmax(220px,2fr)",
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <PersonAvatar person={r.subject} size={28} />
          <span className="min-w-0 truncate">{personName(r.subject)}</span>
          {r.subject.role?.title ? <span className="hidden min-w-0 truncate text-sm font-normal text-ink-2 lg:inline">· {r.subject.role.title}</span> : null}
        </span>
      ),
    },
    { key: "status", label: "Status", width: "180px", render: (r) => <ToneChip tone={reviewStatusOf(r).tone} label={reviewStatusOf(r).label} /> },
    { key: "kpi", label: "KPI", width: "70px", numeric: true, hideBelow: 760, render: (r) => <span>{r.kpiScore == null ? "" : `${Math.round(r.kpiScore)}%`}</span> },
    { key: "self", label: "Self", width: "64px", numeric: true, hideBelow: 700, render: (r) => <span>{selfOf(r)}</span> },
    { key: "manager", label: "Manager", width: "80px", numeric: true, hideBelow: 700, render: (r) => <span>{managerOf(r)}</span> },
    { key: "peers", label: "Peers", width: "64px", numeric: true, hideBelow: 900, render: (r) => <span>{(r.peerFeedback ?? []).filter((p) => p.status === "SUBMITTED").length || ""}</span> },
    { key: "outcome", label: "Outcome", width: "minmax(130px,1fr)", hideBelow: 1000, render: (r) => (r.outcome ? <span className="inline-flex h-6 items-center rounded-md border border-line bg-subtle px-2 text-xs font-medium text-ink">{outcomeLabel(r.outcome)}</span> : null) },
  ];

  return (
    <div className="flex flex-col gap-2">
      {allDone && open ? <p className="m-0 text-sm text-ink-2">Everyone you review is done.</p> : null}
      <TableCard
        ariaLabel="People in this cycle"
        columns={columns}
        rows={sorted}
        rowKey={(r) => r.subjectId}
        rowHref={(r) => `/reviews/${cycleId}?tab=team&person=${r.subjectId}`}
        onRowClick={(r, e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); onOpen(r.subjectId); }}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        rowMenu={(r) => <RowMoreButton label={`Actions for ${personName(r.subject)}`} open={menu?.row.id === r.id} onClick={(e) => setMenu({ row: r, anchor: { current: e.currentTarget } })} />}
        empty={<span className="text-row text-ink-2">Nobody in this cycle reports to you</span>}
        bulkActions={
          <>
            {open ? <BulkAction icon={Bell} label="Send a reminder" onClick={() => void remind([...selected])} /> : null}
            {open ? <BulkAction icon={UserPlus} label="Ask for peer feedback" onClick={() => setAsking(sorted.filter((r) => selected.has(r.subjectId)))} /> : null}
            {!isAgent ? <BulkAction icon={Download} label="Export selected" onClick={() => { window.location.href = `/api/export/reviews/${cycleId}?subjectIds=${[...selected].join(",")}`; }} /> : null}
          </>
        }
        footer={{ total: rows.length, noun: "people", from: rows.length ? 1 : 0, to: rows.length, hidePaging: true, extra: <span className="font-normal">· {done} complete</span> }}
      />

      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={240} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label="Review actions">
            <MenuItem icon={ExternalLink} label="Open review" onClick={() => { const id = menu.row.subjectId; setMenu(null); onOpen(id); }} />
            {open ? <MenuItem icon={UserPlus} label="Ask for peer feedback" onClick={() => { const r = menu.row; setMenu(null); setAsking([r]); }} /> : null}
            <MenuItem icon={UserRound} label="Open their profile" onClick={() => { const id = menu.row.subjectId; setMenu(null); router.push(`/people/${id}`); }} />
            {menu.row.status === "COMPLETED" ? <MenuItem icon={FileText} label="Download their appraisal letter" onClick={() => { const id = menu.row.id; setMenu(null); onOpenLetter(id); }} /> : null}
          </MenuList>
        </MorePortal>
      ) : null}

      {asking ? (
        <AskPeersDialog
          cycleId={cycleId}
          subjects={asking}
          onClose={() => setAsking(null)}
          onDone={() => { setAsking(null); setSelected(new Set()); onChanged(); }}
        />
      ) : null}
    </div>
  );
}
