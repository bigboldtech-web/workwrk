import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

export function formatDate(date: Date | string) {
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string) {
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function getScoreColor(score: number): string {
  if (score >= 90) return "text-green-500";
  if (score >= 70) return "text-purple-400";
  if (score >= 50) return "text-orange-400";
  return "text-red-400";
}

export function getScoreBgColor(score: number): string {
  if (score >= 90) return "bg-green-500";
  if (score >= 70) return "bg-purple-400";
  if (score >= 50) return "bg-orange-400";
  return "bg-red-400";
}

export function getPriorityColor(priority: string): string {
  switch (priority) {
    case "P0": return "bg-red-500/20 text-red-400";
    case "P1": return "bg-orange-500/20 text-orange-400";
    case "P2": return "bg-purple-500/20 text-purple-400";
    case "P3": return "bg-slate-500/20 text-slate-400";
    default: return "bg-slate-500/20 text-slate-400";
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "COMPLETED": return "bg-green-500/20 text-green-400";
    case "IN_PROGRESS": return "bg-blue-500/20 text-blue-400";
    case "IN_REVIEW": return "bg-purple-500/20 text-purple-400";
    case "BLOCKED": return "bg-red-500/20 text-red-400";
    case "NOT_STARTED": return "bg-slate-500/20 text-slate-400";
    default: return "bg-slate-500/20 text-slate-400";
  }
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function calculatePerformanceScore(params: {
  kpiAchievement: number;
  managerRating: number;
  peerRating: number;
  selfRating: number;
  consecutiveGreenMonths: number;
  compliancePenalties: number;
  missedDeadlines: number;
}): number {
  const qualitativeScore =
    (params.managerRating * 0.5 + params.peerRating * 0.3 + params.selfRating * 0.2) / 5 * 100;
  const consistencyBonus = params.consecutiveGreenMonths >= 3 ? 5 : 0;
  const compliancePenalty = params.compliancePenalties * 2 + params.missedDeadlines * 5;
  const cappedKpi = Math.min(params.kpiAchievement, 120);

  const score = (cappedKpi * 0.6) + (qualitativeScore * 0.4) + consistencyBonus - compliancePenalty;
  return Math.max(0, Math.min(100, Math.round(score)));
}
