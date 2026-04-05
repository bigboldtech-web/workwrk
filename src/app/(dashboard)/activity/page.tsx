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
  task_updated: "text-purple-400 bg-purple-500/10",
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
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState("team");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ scope, page: String(page), limit: "30" });
      if (typeFilter) params.set("type", typeFilter);
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
  }, [scope, typeFilter, page]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  useEffect(() => {
    setPage(1);
  }, [scope, typeFilter]);

  const grouped = groupByDate(activities);

  if (error) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Activity Feed</h1>
          <p className="text-muted text-sm mt-1">Track what's happening across your organization</p>
        </div>
        <ErrorState message={error} onRetry={() => fetchActivity()} />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold tracking-tight">Activity Feed</h1>
        <p className="text-muted text-sm mt-1">Track what's happening across your organization</p>
      </div>

      {/* Tabs for My / Team */}
      <Tabs value={scope} onValueChange={setScope}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="my">My Activity</TabsTrigger>
            <TabsTrigger value="team">Team Activity</TabsTrigger>
          </TabsList>
          <Badge variant="secondary" className="text-xs">{pagination.total} events</Badge>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <Filter size={14} className="text-muted" />
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                typeFilter === f.value
                  ? "border-purple-500 bg-purple-500/10 text-purple-400"
                  : "border-border text-muted hover:border-muted-2"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <TabsContent value="my" className="mt-4">
          <ActivityTimeline grouped={grouped} loading={loading} />
        </TabsContent>
        <TabsContent value="team" className="mt-4">
          <ActivityTimeline grouped={grouped} loading={loading} />
        </TabsContent>
      </Tabs>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
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
    </div>
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
