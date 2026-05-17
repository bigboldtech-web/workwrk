"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity, CheckSquare, Users, BookOpen, Calendar, Target, FileText,
  GraduationCap, ChevronLeft, ChevronRight, Filter,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { ListPage } from "@/components/layout/page-shells";
import { useRole } from "@/hooks/use-role";

const ACTIVITY_ICONS: Record<string, any> = {
  task_created: CheckSquare,
  task_completed: CheckSquare,
  task_updated: CheckSquare,
  user_added: Users,
  sop_created: BookOpen,
  meeting_created: Calendar,
  reviews_finalized: Target,
  onboarding_started: GraduationCap,
  onboarding_completed: GraduationCap,
};

const ACTIVITY_COLORS: Record<string, string> = {
  task_created: "text-blue-400 bg-blue-500/10",
  task_completed: "text-green-400 bg-green-500/10",
  task_updated: "text-[color:var(--accent-strong)] bg-[rgba(212,255,46,0.08)]",
  user_added: "text-cyan-400 bg-cyan-500/10",
  sop_created: "text-orange-400 bg-orange-500/10",
  meeting_created: "text-yellow-400 bg-yellow-500/10",
  reviews_finalized: "text-pink-400 bg-pink-500/10",
  onboarding_started: "text-indigo-400 bg-indigo-500/10",
  onboarding_completed: "text-green-400 bg-green-500/10",
};

const TYPE_FILTERS = [
  { value: "", label: "All" },
  { value: "task_completed", label: "Tasks Completed" },
  { value: "task_created", label: "Tasks Created" },
  { value: "user_added", label: "People Added" },
  { value: "sop_created", label: "SOPs Created" },
  { value: "meeting_created", label: "Meetings" },
  { value: "reviews_finalized", label: "Reviews" },
  { value: "onboarding_started", label: "Onboarding" },
];

function formatTimeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

function groupByDate(activities: any[]) {
  const groups: Record<string, any[]> = {};
  activities.forEach((a) => {
    const date = new Date(a.createdAt).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    if (!groups[date]) groups[date] = [];
    groups[date].push(a);
  });
  return groups;
}

export default function ActivityPage() {
  const { isManager } = useRole();
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Default tab — non-managers land on "my activity" since "team
  // activity" wouldn't show them anything they have permission to
  // see anyway. Managers + see team by default (their job).
  const [scope, setScope] = useState(isManager ? "team" : "my");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  // Team member filtering
  const [teamMembers, setTeamMembers] = useState<Array<{ id: string; firstName: string; lastName: string }>>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [selectedActorIds, setSelectedActorIds] = useState<string[]>([]);

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ scope, page: String(page), limit: "30" });
      if (typeFilter) params.set("type", typeFilter);
      if (selectedActorIds.length > 0) params.set("actorIds", selectedActorIds.join(","));
      const res = await fetch(`/api/activity?${params}`);
      if (!res.ok) throw new Error("Failed to load activity data");
      const data = await res.json();
      setActivities(data.data || []);
      setPagination(data.pagination || { total: 0, totalPages: 1 });
    } catch (err) {
      console.error("Failed to fetch activity:", err);
      setError(err instanceof Error ? err.message : "Failed to load activity data");
    } finally {
      setLoading(false);
    }
  }, [scope, typeFilter, page, selectedActorIds]);

  // Load team on mount
  useEffect(() => {
    fetch("/api/my-team")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.members) {
          setTeamMembers(d.members);
          setCurrentUserId(d.self?.id || "");
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  useEffect(() => {
    setPage(1);
  }, [scope, typeFilter, selectedActorIds]);

  const grouped = groupByDate(activities);

  if (error) {
    return (
      <div className="space-y-3 animate-fade-in">
        <PageHeader
          breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Activity" }]}
          kicker="Activity · org-wide feed"
          title="Activity feed"
          subtitle="Track what's happening across your organization."
        />
        <ErrorState message={error} onRetry={() => fetchActivity()} />
      </div>
    );
  }

  // Left filter rail — type chips become a vertical list instead of
  // a top-of-page chip row. Keeps the main column clean for the
  // timeline and lets users scan filter options without horizontal
  // wrapping at narrow widths.
  const filtersRail = (
    <div className="space-y-4 text-sm">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Filter size={12} className="text-muted" />
          <span className="text-[10px] uppercase tracking-wide text-muted font-semibold">Activity type</span>
        </div>
        <div className="space-y-0.5">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`w-full text-left text-xs px-2.5 py-1.5 rounded-md transition-colors ${
                typeFilter === f.value
                  ? "bg-[rgba(124,58,237,0.10)] text-[color:var(--accent-strong)] font-medium"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Team member filter — visible only in team scope */}
      {scope === "team" && teamMembers.length > 1 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wide text-muted font-semibold inline-flex items-center gap-1">
              <Users size={10} /> Actors
            </span>
            {selectedActorIds.length > 0 && (
              <button
                onClick={() => setSelectedActorIds([])}
                className="text-[10px] text-[color:var(--accent-strong)] hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <div className="space-y-0.5 max-h-64 overflow-y-auto">
            {teamMembers.map((m) => {
              const checked = selectedActorIds.includes(m.id);
              return (
                <label
                  key={m.id}
                  className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface-2 cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setSelectedActorIds((prev) =>
                        checked ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                      );
                    }}
                    className="accent-violet-600"
                  />
                  <span className="truncate">
                    {m.firstName} {m.lastName}
                    {m.id === currentUserId && <span className="text-muted-2 ml-1">(you)</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <ListPage
      header={
        <PageHeader
          kicker="Activity · org-wide feed"
          title="Activity feed"
          subtitle="Track what's happening across your organization."
        />
      }
      filters={filtersRail}
    >
      {/* My / Team tabs sit above the timeline since they swap the
          underlying dataset, orthogonal to the type filters in the rail. */}
      <Tabs value={scope} onValueChange={setScope}>
        <div className="flex items-center justify-between mb-3">
          <TabsList>
            <TabsTrigger value="my">My Activity</TabsTrigger>
            {isManager && <TabsTrigger value="team">Team Activity</TabsTrigger>}
          </TabsList>
          <Badge variant="secondary" className="text-xs">{pagination.total} events</Badge>
        </div>

        <TabsContent value="my">
          <ActivityTimeline grouped={grouped} loading={loading} />
        </TabsContent>
        <TabsContent value="team">
          <ActivityTimeline grouped={grouped} loading={loading} />
        </TabsContent>
      </Tabs>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft size={14} />
          </Button>
          <span className="text-sm text-muted">
            Page {page} of {pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={page === pagination.totalPages}
          >
            <ChevronRight size={14} />
          </Button>
        </div>
      )}
    </ListPage>
  );
}

function ActivityTimeline({ grouped, loading }: { grouped: Record<string, any[]>; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-surface rounded-lg border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  const dates = Object.keys(grouped);

  if (dates.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity yet"
        description="Activity will appear here as your team uses WorkwrK."
      />
    );
  }

  return (
    <div className="space-y-6">
      {dates.map((date) => (
        <div key={date}>
          <p className="text-xs font-medium text-muted mb-3">{date}</p>
          <div className="space-y-2">
            {grouped[date].map((activity: any) => {
              const Icon = ACTIVITY_ICONS[activity.type] || Activity;
              const colorClass = ACTIVITY_COLORS[activity.type] || "text-muted bg-surface-2";
              const [textColor, bgColor] = colorClass.split(" ");

              return (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 rounded-lg border border-border bg-background/50 p-3 hover:border-muted-2 transition-colors"
                >
                  <div className={`rounded-lg p-2 ${bgColor} flex-shrink-0`}>
                    <Icon size={14} className={textColor} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{activity.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted">
                        {activity.actor?.firstName} {activity.actor?.lastName}
                      </span>
                      <span className="text-[10px] text-muted">·</span>
                      <span className="text-[10px] text-muted">{formatTimeAgo(activity.createdAt)}</span>
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                        {activity.type.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
