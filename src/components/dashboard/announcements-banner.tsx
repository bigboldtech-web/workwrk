"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Megaphone, AlertTriangle, PartyPopper, FileText, Calendar, Pin, X,
} from "lucide-react";

const TYPE_STYLES: Record<string, { icon: typeof Megaphone; border: string; bg: string }> = {
  INFO: { icon: Megaphone, border: "border-blue-500/30", bg: "bg-blue-500/5" },
  WARNING: { icon: AlertTriangle, border: "border-amber-500/30", bg: "bg-amber-500/5" },
  CELEBRATION: { icon: PartyPopper, border: "border-pink-500/30", bg: "bg-pink-500/5" },
  POLICY: { icon: FileText, border: "border-purple-500/30", bg: "bg-purple-500/5" },
  EVENT: { icon: Calendar, border: "border-green-500/30", bg: "bg-green-500/5" },
};

interface Announcement {
  id: string;
  title: string;
  content: string;
  type: string;
  priority: string;
  pinned: boolean;
  createdAt: string;
}

export function AnnouncementsBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    fetch("/api/announcements")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        const items = d?.data || d || [];
        setAnnouncements(Array.isArray(items) ? items : []);
      })
      .catch(() => {});
  }, []);

  async function dismiss(id: string) {
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    await fetch(`/api/announcements/${id}/dismiss`, { method: "POST" }).catch(() => {});
  }

  if (announcements.length === 0) return null;

  return (
    <div className="space-y-2">
      {announcements.map((a) => {
        const style = TYPE_STYLES[a.type] || TYPE_STYLES.INFO;
        const Icon = style.icon;
        const isUrgent = a.priority === "URGENT" || a.priority === "HIGH";

        return (
          <Card key={a.id} className={`${style.border} ${style.bg} ${isUrgent ? "animate-pulse-glow" : ""}`}>
            <CardContent className="p-3">
              <div className="flex items-start gap-3">
                <Icon size={18} className="mt-0.5 shrink-0 text-muted" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{a.title}</p>
                    {a.pinned && <Pin size={12} className="text-purple-400" />}
                    {isUrgent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">Urgent</span>}
                  </div>
                  <p className="text-xs text-muted mt-0.5">{a.content}</p>
                </div>
                {!a.pinned && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted" onClick={() => dismiss(a.id)}>
                    <X size={14} />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
