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
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-purple-600 text-white shadow-lg hover:bg-purple-700 transition-all hover:scale-105 active:scale-95"
        title="Give Kudos"
      >
        <Heart size={20} />
      </button>
      <KudosModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
