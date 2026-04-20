"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send } from "lucide-react";

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; firstName: string; lastName: string; avatar?: string | null };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

/** Comments thread under a task. Renders empty state for brand-new tasks,
 *  and reuses the Radix Avatar primitive so the fallback matches the rest
 *  of the app. Optimistic-appends the new comment so the thread doesn't
 *  feel laggy. */
export function NotesThread({ taskId }: { taskId: string }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tasks/${taskId}/comments`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const list = Array.isArray(d) ? d : d?.data || [];
        setComments(list);
      })
      .catch(() => setComments([]));
    return () => { cancelled = true; };
  }, [taskId]);

  async function post() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (res.ok) {
        const created = await res.json();
        const comment: Comment = created.data ?? created;
        setComments((prev) => [...(prev ?? []), comment]);
        setBody("");
      }
    } catch {} finally { setSending(false); }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {comments === null ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="text-xs text-muted">No notes yet. Add one to keep the task log moving.</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <Avatar className="h-7 w-7 shrink-0">
                {c.author.avatar ? <AvatarImage src={c.author.avatar} alt="" /> : null}
                <AvatarFallback className="text-[10px]">
                  {c.author.firstName[0]}{c.author.lastName[0]}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="text-xs font-medium">{c.author.firstName} {c.author.lastName}</span>
                  <span className="text-[10px] text-muted">{timeAgo(c.createdAt)}</span>
                </div>
                <p className="text-xs whitespace-pre-wrap">{c.body}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note…"
          rows={2}
          className="flex-1 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); }
          }}
        />
        <Button onClick={post} disabled={!body.trim() || sending} size="icon" aria-label="Post note">
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </Button>
      </div>
    </div>
  );
}
