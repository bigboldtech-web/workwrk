"use client";

// /chat landing — jump straight into the most recent conversation
// (Slack behavior). With nothing to open, an honest empty state that
// hands off to the sidebar's New-chat flow.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Plus } from "lucide-react";

export default function ChatLandingPage() {
  const router = useRouter();
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/conversations", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active) return;
        const first = d?.conversations?.[0];
        if (first?.id) router.replace(`/chat/${first.id}`);
        else setEmpty(true);
      })
      .catch(() => { if (active) setEmpty(true); });
    return () => { active = false; };
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center p-8">
      {empty ? (
        <div className="text-center max-w-sm">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0073EA]/10 text-[#0073EA] mb-3">
            <MessageCircle className="w-6 h-6" />
          </span>
          <h1 className="text-[17px] font-semibold text-zinc-900">Chat with your team</h1>
          <p className="mt-1 text-[14px] text-zinc-500">
            Direct messages, group chats, and one-click audio or video calls — all inside WorkwrK.
          </p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("workwrk:os:new:chat-new"))}
            className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-[#0073EA] text-white text-[14px] font-medium hover:bg-[#0060c2]"
          >
            <Plus className="w-4 h-4" /> Start a conversation
          </button>
        </div>
      ) : (
        <p className="text-[14px] text-zinc-400">Opening your conversations…</p>
      )}
    </div>
  );
}
