"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Globe, Building2, User, Target, Loader2 } from "lucide-react";

/**
 * Cascade view — Company → Team → Individual hierarchy of OKRs for
 * the selected quarter.
 *
 * The data is the same `/api/okrs?quarter=...` response. This file
 * re-shapes it into a tree using `parentId`, then renders columns:
 * the leftmost column is the company-level objectives, then teams
 * underneath their parent, then individuals underneath their team
 * parent. Each card shows progress, status, and owner so anyone
 * scrolling can see where the work is concentrating.
 */

interface OKR {
  id: string;
  title: string;
  level: "COMPANY" | "TEAM" | "INDIVIDUAL";
  status: string;
  progress: number;
  parentId: string | null;
  ownerId: string | null;
  quarter: string | null;
}

const STATUS_BG: Record<string, string> = {
  ON_TRACK: "bg-[rgba(212,255,46,0.10)] text-[#d4ff2e]",
  AT_RISK: "bg-[rgba(245,158,11,0.10)] text-amber-400",
  BEHIND: "bg-[rgba(239,68,68,0.10)] text-red-400",
  COMPLETED: "bg-[rgba(34,197,94,0.10)] text-green-400",
  DRAFT: "bg-surface-2 text-muted",
};

function progressColor(p: number) {
  if (p >= 100) return "bg-green-500";
  if (p >= 70) return "bg-[#d4ff2e]";
  if (p >= 40) return "bg-amber-500";
  return "bg-red-500";
}

const LEVEL_ICON: Record<string, typeof Globe> = {
  COMPANY: Globe, TEAM: Building2, INDIVIDUAL: User,
};

interface UserLite { id: string; firstName: string; lastName: string }

export function CascadeTree({ quarter }: { quarter: string }) {
  const [okrs, setOkrs] = useState<OKR[]>([]);
  const [users, setUsers] = useState<Map<string, UserLite>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      fetch(`/api/okrs?quarter=${encodeURIComponent(quarter)}`).then((r) => r.ok ? r.json() : { data: [] }),
      fetch("/api/users?limit=300").then((r) => r.ok ? r.json() : { data: [] }),
    ])
      .then(([okrRes, userRes]) => {
        if (!alive) return;
        const list = Array.isArray(okrRes) ? okrRes : okrRes.data || [];
        setOkrs(list);
        const userList = Array.isArray(userRes) ? userRes : userRes.data || [];
        setUsers(new Map(userList.map((u: UserLite) => [u.id, u])));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [quarter]);

  if (loading) {
    return (
      <Card><CardContent className="p-8 text-center text-sm text-muted">
        <Loader2 size={18} className="animate-spin mx-auto mb-2" /> Loading cascade…
      </CardContent></Card>
    );
  }

  if (okrs.length === 0) {
    return (
      <Card><CardContent className="p-8 text-center">
        <Target size={32} className="mx-auto text-muted mb-2" />
        <p className="text-sm font-medium">No OKRs to cascade for {quarter}</p>
        <p className="text-xs text-muted mt-1">Create company-level objectives, then nest team and individual OKRs underneath.</p>
      </CardContent></Card>
    );
  }

  // Build the tree.
  const childrenOf = new Map<string | null, OKR[]>();
  for (const o of okrs) {
    const arr = childrenOf.get(o.parentId) || [];
    arr.push(o);
    childrenOf.set(o.parentId, arr);
  }

  // Roots = OKRs without a parent. Render top-down.
  const roots = childrenOf.get(null) || [];

  return (
    <div className="space-y-3">
      {roots.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted text-center">
          No top-level objectives this quarter. Add a Company OKR to anchor the cascade.
        </CardContent></Card>
      ) : roots.map((node) => (
        <CascadeNode
          key={node.id}
          node={node}
          childrenOf={childrenOf}
          users={users}
          depth={0}
        />
      ))}
    </div>
  );
}

function CascadeNode({
  node, childrenOf, users, depth,
}: {
  node: OKR;
  childrenOf: Map<string | null, OKR[]>;
  users: Map<string, UserLite>;
  depth: number;
}) {
  const kids = childrenOf.get(node.id) || [];
  const Icon = LEVEL_ICON[node.level] || Target;
  const owner = node.ownerId ? users.get(node.ownerId) : null;
  const status = STATUS_BG[node.status] || STATUS_BG.DRAFT;

  return (
    <div className="relative">
      {/* Vertical guide line for nested children. Keeps the eye
          tracking the hierarchy without a heavy tree library. */}
      {kids.length > 0 && (
        <div
          aria-hidden
          className="absolute top-[58px] bottom-0 border-l border-dashed border-border"
          style={{ left: `${depth * 24 + 13}px` }}
        />
      )}

      <Card className="hover:border-muted-2 transition-colors">
        <CardContent className="p-3">
          <div className="flex items-center gap-3" style={{ paddingLeft: depth * 12 }}>
            <div className="h-7 w-7 rounded-lg bg-surface-2 border border-border flex items-center justify-center shrink-0">
              <Icon size={13} className="text-muted" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm truncate">{node.title}</span>
                <Badge variant="outline" className="text-[9px] uppercase">{node.level}</Badge>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${status}`}>
                  {node.status.replace("_", " ").toLowerCase()}
                </span>
              </div>
              {owner && (
                <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted">
                  <Avatar className="h-4 w-4"><AvatarFallback className="text-[8px]">{owner.firstName[0]}{owner.lastName[0]}</AvatarFallback></Avatar>
                  {owner.firstName} {owner.lastName}
                </div>
              )}
            </div>
            <div className="shrink-0 flex items-center gap-2 w-32">
              <Progress value={node.progress} className="h-1 flex-1" indicatorClassName={progressColor(node.progress)} />
              <span className="text-xs font-mono tabular-nums w-9 text-right">{node.progress}%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {kids.length > 0 && (
        <div className="mt-2 space-y-2 pl-6">
          {kids.map((child) => (
            <CascadeNode
              key={child.id}
              node={child}
              childrenOf={childrenOf}
              users={users}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
