"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  Search,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Link2,
  Copy,
  ExternalLink,
  ListChecks,
} from "lucide-react";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";

interface ProcessRun {
  id: string;
  title: string;
  status: string;
  progress: number;
  dueDate: string | null;
  shareToken: string | null;
  completedAt: string | null;
  createdAt: string;
  sop: {
    id: string;
    title: string;
    category: string | null;
    sopType: string;
  };
}

function getStatusBadge(status: string) {
  switch (status) {
    case "ACTIVE":
      return <Badge variant="warning">Active</Badge>;
    case "COMPLETED":
      return <Badge variant="success">Completed</Badge>;
    case "OVERDUE":
      return <Badge variant="destructive">Overdue</Badge>;
    case "CANCELLED":
      return <Badge variant="outline">Cancelled</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "ACTIVE":
      return <Play size={14} className="text-amber-400" />;
    case "COMPLETED":
      return <CheckCircle2 size={14} className="text-green-400" />;
    case "OVERDUE":
      return <AlertCircle size={14} className="text-red-400" />;
    case "CANCELLED":
      return <XCircle size={14} className="text-muted" />;
    default:
      return <Clock size={14} className="text-muted" />;
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "---";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ProcessRunsPage() {
  const [runs, setRuns] = useState<ProcessRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { success: toastSuccess } = useToast();

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/process-runs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setRuns(data.data || data || []);
      }
    } catch (err) {
      console.error("Error fetching process runs:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const filtered = runs.filter((r) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        r.title.toLowerCase().includes(q) ||
        r.sop.title.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeCount = runs.filter((r) => r.status === "ACTIVE").length;
  const completedCount = runs.filter((r) => r.status === "COMPLETED").length;
  const overdueCount = runs.filter(
    (r) =>
      r.status === "ACTIVE" &&
      r.dueDate &&
      new Date(r.dueDate) < new Date()
  ).length;

  function copyLink(token: string) {
    const link = `${window.location.origin}/run/${token}`;
    navigator.clipboard.writeText(link);
    toastSuccess("Link copied!");
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Process Runs</h1>
        <p className="text-muted text-sm mt-1">
          Track active and completed checklist executions
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{runs.length}</p>
            <p className="text-xs text-muted">Total Runs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{activeCount}</p>
            <p className="text-xs text-muted">Active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{completedCount}</p>
            <p className="text-xs text-muted">Completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{overdueCount}</p>
            <p className="text-xs text-muted">Overdue</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            placeholder="Search runs..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="OVERDUE">Overdue</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Runs List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-12 bg-surface-2 rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No process runs yet"
          description="Create a checklist SOP and start a process run to track execution."
          actionLabel="Go to SOPs"
          onAction={() => (window.location.href = "/sops")}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((run) => {
            const isOverdue =
              run.status === "ACTIVE" &&
              run.dueDate &&
              new Date(run.dueDate) < new Date();

            return (
              <Card
                key={run.id}
                className="hover:border-muted-2 transition-all"
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Status Icon */}
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-purple-500/10 shrink-0">
                      {getStatusIcon(isOverdue ? "OVERDUE" : run.status)}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium truncate">
                          {run.title}
                        </p>
                        {getStatusBadge(isOverdue ? "OVERDUE" : run.status)}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted">
                        <Link
                          href={`/sops/${run.sop.id}`}
                          className="hover:text-purple-400 transition-colors"
                        >
                          {run.sop.title}
                        </Link>
                        <span>Started {formatDate(run.createdAt)}</span>
                        {run.dueDate && (
                          <span
                            className={
                              isOverdue ? "text-red-400 font-medium" : ""
                            }
                          >
                            Due {formatDate(run.dueDate)}
                          </span>
                        )}
                        {run.completedAt && (
                          <span className="text-green-400">
                            Completed {formatDate(run.completedAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress */}
                    <div className="flex items-center gap-3 shrink-0 min-w-[160px]">
                      <Progress value={run.progress} className="h-2 flex-1" />
                      <span className="text-xs font-mono font-bold text-purple-400 w-10 text-right">
                        {run.progress}%
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {run.shareToken && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted hover:text-foreground"
                            onClick={() => copyLink(run.shareToken!)}
                            title="Copy share link"
                          >
                            <Copy size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted hover:text-foreground"
                            onClick={() =>
                              window.open(
                                `/run/${run.shareToken}`,
                                "_blank"
                              )
                            }
                            title="Open run"
                          >
                            <ExternalLink size={14} />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
