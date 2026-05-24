"use client";

// ITSM → Knowledge base board.

import { useCallback, useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { BoardShell } from "@/components/layout/board-shell";
import { useActiveWorkspace } from "@/hooks/use-active-workspace";
import {
  NewArticleModal, EmptyState, timeAgo, type KbArticle,
} from "@/components/itsm/shared";

export default function ItsmKbPage() {
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const workspaceId = useActiveWorkspace("workwrk-itsm");
  const wsQuery = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : "";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/itsm/kb-articles${wsQuery}`);
      const d = r.ok ? await r.json() : { articles: [] };
      setArticles(d.articles || []);
    } finally { setLoading(false); }
  }, [wsQuery]);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <BoardShell
      productSlug="workwrk-itsm"
      boardKey="kb"
      viewMode="table"
      primaryAction={{ label: "New article", onClick: () => setShowNew(true) }}
      titleAccessory={
        <span className="ml-2 text-xs text-muted-2 tabular-nums">{articles.length}</span>
      }
    >
      {loading ? (
        <div className="text-sm text-muted py-20 text-center">Loading articles…</div>
      ) : articles.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            Icon={BookOpen}
            title="Knowledge base is empty"
            hint="Write articles to deflect repeat tickets. Your agents can answer from these."
            action={{ label: "Write first article", onClick: () => setShowNew(true) }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {articles.map((a) => (
            <article key={a.id} className="rounded-xl border border-border bg-surface p-4 hover:border-blue-300 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen size={14} className="text-blue-600" />
                {a.category && <span className="text-[10px] font-medium uppercase tracking-wider text-muted-2">{a.category}</span>}
                {!a.publishedAt && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">DRAFT</span>}
              </div>
              <h3 className="font-semibold text-sm mb-1.5">{a.title}</h3>
              {a.excerpt && <p className="text-xs text-muted line-clamp-3 mb-2">{a.excerpt}</p>}
              <div className="flex items-center gap-3 text-[11px] text-muted-2">
                <span>{a.viewCount} views</span>
                <span>·</span>
                <span>{timeAgo(a.updatedAt)} ago</span>
              </div>
            </article>
          ))}
        </div>
      )}

      {showNew && (
        <NewArticleModal
          workspaceId={workspaceId}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); refresh(); }}
        />
      )}
    </BoardShell>
  );
}
