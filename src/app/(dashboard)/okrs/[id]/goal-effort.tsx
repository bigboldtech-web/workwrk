"use client";

// GoalEffort — the automated "effort" panel on a goal. Shows how much real work
// is moving the goal (hours logged, tasks done vs open, who's contributing, when
// it last moved) — all derived from the goal's linked KRAs' tasks, never
// self-reported. Empty state nudges linking a KRA/board.

import { useEffect, useState } from "react";
import { Activity, Clock, CheckCircle2, CircleDot } from "lucide-react";

interface Effort {
  hasLinkedWork: boolean;
  linkedKras: number;
  linkedBoards?: number;
  totalHours: number;
  tasksDone: number;
  tasksOpen: number;
  lastActivityAt: string | null;
  contributors: { id: string; name: string; hours: number; tasks: number }[];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
function relDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function GoalEffort({ okrId }: { okrId: string }) {
  const [data, setData] = useState<Effort | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/okrs/${okrId}/effort`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load"))))
      .then((j) => { if (active) setData(j.data ?? j); })
      .catch(() => { if (active) setErr(true); });
    return () => { active = false; };
  }, [okrId]);

  if (err) return <p style={{ fontSize: 13, color: "var(--os-ink-3, #9aa3b2)" }}>Couldn&apos;t load effort.</p>;
  if (!data) return <p style={{ fontSize: 13, color: "var(--os-ink-3, #9aa3b2)" }}>Loading effort…</p>;

  if (!data.hasLinkedWork) {
    return (
      <p style={{ fontSize: 13, color: "var(--os-ink-3, #9aa3b2)", lineHeight: 1.5 }}>
        No linked work yet. Link a KRA, Board or Space (below) and the effort behind this goal — hours logged, tasks moving, who&apos;s contributing — fills in automatically from that work.
      </p>
    );
  }

  const stat = (Icon: typeof Clock, label: string, value: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 96 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "var(--os-ink-3, #9aa3b2)", textTransform: "uppercase", letterSpacing: ".03em" }}>
        <Icon style={{ width: 13, height: 13 }} /> {label}
      </span>
      <span style={{ fontSize: 20, fontWeight: 700, color: "var(--os-ink, #1e293b)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        {stat(Clock, "Hours logged", `${data.totalHours}`)}
        {stat(CheckCircle2, "Tasks done", `${data.tasksDone}`)}
        {stat(CircleDot, "In progress", `${data.tasksOpen}`)}
        {stat(Activity, "Last moved", relDate(data.lastActivityAt))}
      </div>
      {data.contributors.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--os-ink-3, #9aa3b2)", textTransform: "uppercase", letterSpacing: ".03em" }}>Who&apos;s driving it</span>
          <ul style={{ display: "flex", flexDirection: "column", gap: 4, margin: 0, padding: 0, listStyle: "none" }}>
            {data.contributors.slice(0, 6).map((c) => (
              <li key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ width: 22, height: 22, borderRadius: 22, background: "#0073EA", color: "#fff", fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center", flex: "none" }}>{initials(c.name)}</span>
                <span style={{ flex: 1, minWidth: 0, color: "var(--os-ink, #1e293b)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                <span style={{ color: "var(--os-ink-3, #9aa3b2)", fontVariantNumeric: "tabular-nums" }}>{c.hours}h · {c.tasks} task{c.tasks === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
