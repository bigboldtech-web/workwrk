"use client";

// CreateMenu (spec-shell 2.10): make something new from anywhere. One
// 280px MenuList under the bar's "+" (and the Work sidebar's header "+"),
// rows 36 with a 16px icon, a label and the registry's chord:
//
//   Task · Doc · List · Reminder · Notepad · Voice note
//   From template… · Space
//   Ask AI
//
// Rows are absent, never disabled: Voice note needs the Web Speech API, From
// template and Space are for Members (never Guests or Agents), Ask AI only
// when the AI hub is visible. No AI free-text input, no Sprint, no Import,
// no Customize row (each has its own door). The menu closes before the next
// layer opens, so the LayerStack never holds a menu under a modal.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlarmClock, Building2, CheckSquare, FileText, LayoutTemplate, ListTodo, Mic, NotebookPen, Sparkles,
} from "lucide-react";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { apiFetch } from "@/lib/api-fetch";
import { shortcutHint } from "@/lib/shortcuts";
import { SHELL_LABELS } from "@/lib/nav/labels";
import { ChromePopover } from "./chrome-popover";
import { useOsShell } from "./shell-context";
import { useViewerRole } from "./boot-context";
import { useOsToast } from "./toast";
import { NewSpaceDialog } from "./new-space-dialog";
import { refreshSidebar } from "./sidebar-refresh";
import { objectHrefNow } from "./use-object-href";

function hasSpeechRecognition(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function CreateMenu({
  open,
  onOpenChange,
  trigger,
  align = "end",
  layerId = "create-menu",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  align?: "start" | "center" | "end";
  layerId?: string;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const { openCreateTask, openCreateList, openTemplateCenter, openSidekick, railApps, canCreateSpace } = useOsShell();
  const { isGuest } = useViewerRole();
  // The popover content only mounts when open, so this runs on the client.
  const [voice] = useState(() => hasSpeechRecognition());
  const [spaceOpen, setSpaceOpen] = useState(false);

  const close = () => onOpenChange(false);
  const aiVisible = railApps.some((a) => a.key === "ai");
  const isMember = !isGuest;
  // POST /api/spaces refuses below the manager tier, so the Space row is
  // absent (never disabled) for everyone else: a row that appears always
  // works (spec-shell 2.10). `canCreateSpace` is the shell's one answer
  // (Agents and Guests are false there too).

  const createDoc = async () => {
    close();
    const r = await apiFetch<{ doc?: { id?: string } }>("/api/docs", {
      method: "POST",
      json: { title: "Untitled doc", content: { type: "doc", content: [{ type: "paragraph" }] } },
    });
    const id = r.ok ? r.data?.doc?.id : undefined;
    if (!id) {
      toast("Couldn't create doc. Try again");
      return;
    }
    // In the section the person is in: the Work door in Work, /docs elsewhere.
    router.push(objectHrefNow("doc", id));
  };

  const tool = (detail: "reminder" | "notepad" | "voice") => {
    close();
    // The three personal-capture overlays listen for this until their
    // rewrite (spec-shell 2.19 to 2.21) replaces the event with the LayerStack.
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("workwrk:tool", { detail })), 0);
  };

  return (
    <>
      <ChromePopover open={open} onOpenChange={onOpenChange} trigger={trigger} width={280} align={align} layerId={layerId} ariaLabel={SHELL_LABELS.create}>
        <div className="py-1">
          {isMember ? (
            <MenuItem icon={CheckSquare} label="Task" shortcut={shortcutHint("create-task")} onClick={() => { close(); openCreateTask(); }} />
          ) : null}
          <MenuItem icon={FileText} label="Doc" onClick={() => { void createDoc(); }} />
          {isMember ? (
            <MenuItem icon={ListTodo} label="List" onClick={() => { close(); openCreateList(); }} />
          ) : null}
          <MenuItem icon={AlarmClock} label="Reminder" onClick={() => tool("reminder")} />
          <MenuItem icon={NotebookPen} label="Notepad" onClick={() => tool("notepad")} />
          {voice ? <MenuItem icon={Mic} label="Voice note" onClick={() => tool("voice")} /> : null}
          {isMember ? (
            <>
              <MenuSeparator />
              <MenuItem icon={LayoutTemplate} label="From template…" onClick={() => { close(); openTemplateCenter(); }} />
              {canCreateSpace ? (
                <MenuItem icon={Building2} label="Space" onClick={() => { close(); setSpaceOpen(true); }} />
              ) : null}
            </>
          ) : null}
          {aiVisible && isMember ? (
            <>
              <MenuSeparator />
              <MenuItem icon={Sparkles} label={SHELL_LABELS.askAi} shortcut={shortcutHint("ask-ai")} onClick={() => { close(); openSidekick(); }} />
            </>
          ) : null}
        </div>
      </ChromePopover>
      <NewSpaceDialog
        open={spaceOpen}
        onOpenChange={setSpaceOpen}
        onCreated={() => { refreshSidebar(); router.refresh(); }}
      />
    </>
  );
}
