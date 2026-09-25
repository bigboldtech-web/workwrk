"use client";

// usePersonalTools: the pin list and the runner behind the bar's tool strip
// and Avatar > Personal tools. One hook so both surfaces agree on which tool
// does what and where the pins are stored (`sidebar.quickTools`).

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { useOsShell } from "./shell-context";
import { useOsToast } from "./toast";
import { PERSONAL_TOOLS, readToolPins, togglePin, type PersonalTool } from "./personal-tools";
import { objectHrefNow } from "./use-object-href";

function hasSpeechRecognition(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function usePersonalTools() {
  const router = useRouter();
  const { toast } = useOsToast();
  const { prefs, patchPrefs, openCreateTask } = useOsShell();
  const [speech] = useState(() => hasSpeechRecognition());

  const tools = useMemo(() => PERSONAL_TOOLS.filter((t) => !t.needsSpeech || speech), [speech]);
  const pins = useMemo(() => readToolPins(prefs.sidebar.quickTools), [prefs.sidebar.quickTools]);
  const pinned = useMemo(() => pins.map((k) => tools.find((t) => t.key === k)).filter((t): t is PersonalTool => Boolean(t)), [pins, tools]);

  const toggle = useCallback(
    async (key: string) => {
      const ok = await patchPrefs({ sidebar: { quickTools: togglePin(pins, key) } });
      if (!ok) toast("Couldn't save your pinned tools");
    },
    [pins, patchPrefs, toast],
  );

  const run = useCallback(
    async (tool: PersonalTool) => {
      switch (tool.action) {
        case "create-task":
          openCreateTask();
          return;
        case "my-work":
        case "notepad":
        case "reminder":
        case "voice":
          // The capture overlays and the My work peek listen for this (create-menu.tsx does the same).
          window.setTimeout(() => window.dispatchEvent(new CustomEvent("workwrk:tool", { detail: tool.action })), 0);
          return;
        case "doc": {
          const r = await apiFetch<{ doc?: { id?: string } }>("/api/docs", {
            method: "POST",
            json: { title: "Untitled doc", content: { type: "doc", content: [{ type: "paragraph" }] } },
          });
          const id = r.ok ? r.data?.doc?.id : undefined;
          if (!id) { toast("Couldn't create doc. Try again"); return; }
          // In the section the person is in: the Work door in Work, /docs elsewhere.
          router.push(objectHrefNow("doc", id));
          return;
        }
        case "canvas": {
          // Make the canvas here and open it with ?new=1 (the title is
          // selected), in the section the person is in. If the create fails,
          // /canvas?new=1 is the old door and still makes one, so the tool
          // never dead-ends.
          const r = await apiFetch<{ whiteboard?: { id?: string } }>("/api/whiteboards", {
            method: "POST",
            json: { name: "Untitled canvas" },
          });
          const id = r.ok ? r.data?.whiteboard?.id : undefined;
          router.push(id ? `${objectHrefNow("canvas", id)}?new=1` : "/canvas?new=1");
          return;
        }
        default:
          if (tool.href) router.push(tool.href);
      }
    },
    [openCreateTask, router, toast],
  );

  return { tools, pins, pinned, toggle, run };
}
