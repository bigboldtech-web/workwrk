"use client";

// Audit trail viewer. Filters: type, severity, actor (free-text email
// match), date range. Cursor-paginated; UI loads more on demand so a
// Fortune-500 admin scrolling through millions of rows doesn't load
// them all up front.

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ShieldCheck, Filter, ChevronDown } from "lucide-react";

type AuditRow = {
  id: string;
  type: string;
  description: string;
  targetType: string | null;
  targetId: string | null;
  severity: "info" | "warning" | "critical";
  oldValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: { id: string; firstName: string; lastName: string; email: string } | null;
};

const SEVERITY_STYLE: Record<string, string> = {
  info: "text-muted border-white/20",
  warning: "text-amber-400 border-amber-400/30",
  critical: "text-red-400 border-red-400/30",
};

export default function AuditPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("");
  const [actorEmail, setActorEmail] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Build the query string from current filters.
  const buildUrl = useCallback(
    (cursor: string | null) => {
      const sp = new URLSearchParams();
      sp.set("limit", "100");
      if (type) sp.set("type", type);
      if (severity) sp.set("severity", severity);
      if (startDate) sp.set("startDate", startDate);
      if (endDate) sp.set("endDate", endDate);
      if (cursor) sp.set("cursor", cursor);
      return `/api/audit?${sp.toString()}`;
    },
    [type, severity, startDate, endDate],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(buildUrl(null));
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't load", description: data?.error });
        return;
      }
      setRows(data.items ?? []);
      setNextCursor(data.nextCursor ?? null);
    } finally { setLoading(false); }
  }, [buildUrl, toast]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(buildUrl(nextCursor));
      const data = await res.json();
      if (!res.ok) return;
      setRows((prev) => [...prev, ...(data.items ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } finally { setLoadingMore(false); }
  }

  useEffect(() => { load(); }, [load]);

  // Client-side actor filter — keeps the API clean, fast enough at
  // page-size 100. Server-side actor lookup can come later.
  const filtered = useMemo(() => {
    if (!actorEmail) return rows;
    const q = actorEmail.toLowerCase();
    return rows.filter((r) => r.actor?.email?.toLowerCase().includes(q));
  }, [rows, actorEmail]);

  // Distinct types in the current page for the filter dropdown.
  const distinctTypes = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.type);
    return Array.from(s).sort();
  }, [rows]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck size={20} /> Audit trail
          </h1>
          <p className="text-muted text-sm mt-1">
            Every action across the platform — who changed what, when, from
            where. Source for SOX, SOC 2, and internal compliance reviews.
          </p>
        </div>
        <a
          href={`/api/export/audit${startDate || endDate ? `?${new URLSearchParams({ ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) }).toString()}` : ""}`}
          className="inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-md border border-line text-fg hover:bg-card-2/40 flex-shrink-0"
        >
          Export CSV
        </a>
      </div>

      <Card>
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-5 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1"><Filter size={10} /> Type</Label>
            <Select value={type || "all"} onValueChange={(v) => setType(v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {distinctTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Severity</Label>
            <Select value={severity || "all"} onValueChange={(v) => setSeverity(v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Actor email</Label>
            <Input value={actorEmail} onChange={(e) => setActorEmail(e.target.value)} placeholder="email@" className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 text-xs" />
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted">No matching events.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {filtered.map((r) => {
                const isOpen = expanded === r.id;
                const hasDiff = r.oldValue || r.newValue || r.ipAddress;
                return (
                  <li key={r.id} className="p-3">
                    <button
                      type="button"
                      className="w-full text-left flex items-start gap-3"
                      onClick={() => hasDiff && setExpanded(isOpen ? null : r.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{r.description}</span>
                          <Badge variant="outline" className={`text-[10px] ${SEVERITY_STYLE[r.severity]}`}>
                            {r.severity}
                          </Badge>
                          <code className="text-[10px] text-muted bg-card-2/30 px-1.5 py-0.5 rounded">{r.type}</code>
                        </div>
                        <div className="text-[10px] text-muted mt-1 flex items-center gap-2 flex-wrap">
                          <span>{new Date(r.createdAt).toLocaleString()}</span>
                          {r.actor && (
                            <>
                              <span>·</span>
                              <span>{r.actor.firstName} {r.actor.lastName}</span>
                              <span className="opacity-60">{r.actor.email}</span>
                            </>
                          )}
                          {r.targetType && r.targetId && (
                            <>
                              <span>·</span>
                              <span className="font-mono">{r.targetType}#{r.targetId.slice(0, 8)}</span>
                            </>
                          )}
                          {r.ipAddress && (
                            <>
                              <span>·</span>
                              <span className="font-mono">{r.ipAddress}</span>
                            </>
                          )}
                        </div>
                      </div>
                      {hasDiff && (
                        <ChevronDown
                          size={14}
                          className={`text-muted flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        />
                      )}
                    </button>
                    {isOpen && hasDiff && (
                      <div className="mt-3 ml-1 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                        {r.oldValue !== null && r.oldValue !== undefined && (
                          <div className="rounded-md border border-red-400/20 bg-red-400/5 p-2">
                            <div className="text-[10px] uppercase text-red-400 mb-1">Before</div>
                            <pre className="font-mono text-[11px] whitespace-pre-wrap break-all">
                              {JSON.stringify(r.oldValue, null, 2)}
                            </pre>
                          </div>
                        )}
                        {r.newValue !== null && r.newValue !== undefined && (
                          <div className="rounded-md border border-green-400/20 bg-green-400/5 p-2">
                            <div className="text-[10px] uppercase text-green-400 mb-1">After</div>
                            <pre className="font-mono text-[11px] whitespace-pre-wrap break-all">
                              {JSON.stringify(r.newValue, null, 2)}
                            </pre>
                          </div>
                        )}
                        {r.userAgent && (
                          <div className="md:col-span-2 text-[10px] text-muted truncate">
                            ua: <span className="font-mono">{r.userAgent}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load 100 more"}
          </Button>
        </div>
      )}
    </div>
  );
}
