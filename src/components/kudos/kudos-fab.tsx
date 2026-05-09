"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { KudosModal } from "./kudos-modal";

export function KudosFab() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full text-white shadow-[0_8px_24px_-6px_rgba(190,24,93,0.55)] hover:shadow-[0_10px_28px_-6px_rgba(190,24,93,0.7)] transition-all hover:scale-105 active:scale-95"
        style={{ background: "linear-gradient(135deg, #ec4899 0%, #be185d 100%)" }}
        title="Give Kudos"
      >
        <Heart size={20} fill="currentColor" />
      </button>
      <KudosModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
