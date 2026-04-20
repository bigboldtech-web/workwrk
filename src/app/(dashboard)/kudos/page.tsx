"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Heart, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { KudosModal } from "@/components/kudos/kudos-modal";
import { KudosReactions, type ReactionCount } from "@/components/kudos/kudos-reactions";
import { cn } from "@/lib/utils";

interface KudosItem {
  id: string;
  message: string;
  companyValue: string | null;
  giver: { id: string; firstName: string; lastName: string; avatar: string | null; role?: { title: string } | null };
  receiver: { id: string; firstName: string; lastName: string; avatar: string | null; role?: { title: string } | null; department?: { name: string } | null };
  createdAt: string;
  reactionCounts: ReactionCount[];
  totalReactions: number;
  myReactions: string[];
}

type Filter = "all" | "received" | "given";
type Sort = "recent" | "reactions";

const QUICK_VALUES = ["Customer First", "Ownership", "Teamwork", "Innovation", "Excellence", "Integrity", "Growth Mindset", "Collaboration"];

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function KudosFeedPage() {
  const [kudos, setKudos] = useState<KudosItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [valueFilter, setValueFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("recent");
  const [modalOpen, setModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => setMe(s?.user?.id || null))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter === "received" && me) params.set("userId", me);
    if (filter === "given" && me) params.set("givenBy", me);
    if (valueFilter) params.set("value", valueFilter);
    params.set("sort", sort);
    params.set("page", String(page));
    params.set("limit", "24");
    try {
      const res = await fetch(`/api/kudos?${params.toString()}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setKudos(json.data || []);
      setTotalPages(json.pagination?.totalPages || 1);
    } catch {
      setKudos([]);
    } finally {
      setLoading(false);
    }
  }, [filter, valueFilter, sort, page, me]);

  useEffect(() => {
    // Skip first-load until we know who "me" is (for the received/given filters)
    if (filter !== "all" && !me) return;
    load();
  }, [load, filter, me]);

  const onKudosModalClose = () => {
    setModalOpen(false);
    load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Culture · live"
        title="Culture is what gets rewarded."
        subtitle="Peer-to-peer kudos tagged to your company values. Counted on profiles, surfaced in reviews, fed into composite scores. Great work stops being invisible."
        actions={[
          { label: "Give Kudos", onClick: () => setModalOpen(true), tone: "lime", variant: "primary", icon: <Heart size={14} /> },
        ]}
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
          {(["all", "received", "given"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1); }}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize",
                filter === f ? "bg-[#d4ff2e] text-[#0a0a0a]" : "text-muted hover:text-foreground",
              )}
            >
              {f === "all" ? "All" : f === "received" ? "Received by me" : "Given by me"}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
          {(["recent", "reactions"] as Sort[]).map((s) => (
            <button
              key={s}
              onClick={() => { setSort(s); setPage(1); }}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                sort === s ? "bg-surface text-foreground" : "text-muted hover:text-foreground",
              )}
            >
              {s === "recent" ? "Most recent" : "Most reactions"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5 ml-auto">
          <button
            onClick={() => { setValueFilter(null); setPage(1); }}
            className={cn(
              "text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors",
              valueFilter === null ? "border-[#d4ff2e] bg-[rgba(212,255,46,0.12)] text-[#d4ff2e]" : "border-border text-muted hover:text-foreground",
            )}
          >
            All values
          </button>
          {QUICK_VALUES.map((v) => (
            <button
              key={v}
              onClick={() => { setValueFilter(valueFilter === v ? null : v); setPage(1); }}
              className={cn(
                "text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border transition-colors",
                valueFilter === v ? "border-[#d4ff2e] bg-[rgba(212,255,46,0.12)] text-[#d4ff2e]" : "border-border text-muted hover:text-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted">
          <Loader2 className="animate-spin" size={20} />
        </div>
      ) : kudos.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Sparkles className="mx-auto mb-3 text-muted" size={28} />
            <p className="text-sm text-muted">No kudos yet in this view.</p>
            <Button className="mt-4 gap-2" onClick={() => setModalOpen(true)}>
              <Heart size={14} /> Give the first kudos
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {kudos.map((k) => (
            <div
              key={k.id}
              className="relative rounded-xl border border-border bg-surface-2/50 p-5 hover:bg-surface-2 transition-colors"
            >
              {k.companyValue && (
                <Badge
                  variant="outline"
                  className="absolute top-4 right-4 text-[10px] uppercase tracking-wider border-[#d4ff2e]/40 text-[#d4ff2e] bg-[rgba(212,255,46,0.06)]"
                >
                  {k.companyValue}
                </Badge>
              )}

              <div className="flex items-center gap-2 mb-3 text-sm pr-28">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[10px] bg-[rgba(212,255,46,0.12)] text-[#d4ff2e]">
                    {k.giver.firstName[0]}{k.giver.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium">{k.giver.firstName} {k.giver.lastName[0]}.</span>
                <ArrowRight size={14} className="text-muted" />
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[10px] bg-[rgba(212,255,46,0.12)] text-[#d4ff2e]">
                    {k.receiver.firstName[0]}{k.receiver.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium">{k.receiver.firstName} {k.receiver.lastName[0]}.</span>
              </div>

              <p className="italic text-[15px] leading-relaxed text-foreground mb-4">
                &ldquo;{k.message}&rdquo;
              </p>

              <div className="pt-3 border-t border-border/60">
                <div className="flex items-center justify-between gap-3">
                  <KudosReactions
                    kudosId={k.id}
                    initialCounts={k.reactionCounts}
                    initialMine={k.myReactions}
                  />
                  <span className="text-[10px] text-muted flex-shrink-0">{timeAgo(k.createdAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <span className="text-xs text-muted px-2">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Next
          </Button>
        </div>
      )}

      <KudosModal open={modalOpen} onClose={onKudosModalClose} />
    </div>
  );
}
