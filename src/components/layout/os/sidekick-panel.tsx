"use client";

/* The Ask AI panel (spec-ai-automation section 2, "Ask AI panel").
 *
 * Ask the assistant without leaving the page you are on. The container is
 * the shell's (spec-shell 2.1): 360 wide at the inline end, it PUSHES the
 * content column and never overlays it, never on a scrim. Below 1024 it does
 * not render at all (os-shell.tsx) and every entry point navigates to
 * /sidekick instead (shell-context openSidekick).
 *
 * ONE SESSION. The body is AskAiThread, the same component the /sidekick
 * page renders, over the same useAiSession() store, so this panel and the
 * page are one thread: "Open full page" lands on ?session=<id> with the
 * answer still arriving, closing the panel does not end the chat, and the
 * shell closes the panel on /sidekick so two threads are never on screen.
 *
 * .os-chrome: drawn on the px grid like the rest of the frame, so its 48px
 * header, 32px icon buttons and 36px starters are those sizes.
 *
 * Its own 48px header is its whole chrome: the title and three ghost icons,
 * New chat, Open full page and Close. The model pill, the "More" menu, the
 * History toggle (history is the AI hub sidebar's CHATS section), Attach,
 * "All sources" and the Suggested / Featured / Search lists that advertised
 * things the backend cannot do are gone.
 *
 * A layer in the shell's LayerStack: Esc closes it (and Cmd+J, from anywhere
 * including its own composer). Focus moves into the composer on open, Tab
 * stays inside the panel while it is open, and focus goes back to whatever
 * opened it on close. Closed, it is `inert` and aria-hidden.
 *
 * Page context: a chat started here carries the first two segments of the
 * page under the panel (productContext / boardContext), so the model knows
 * "the user is on /spaces/marketing" without asking.
 */

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Maximize2, Plus, X } from "lucide-react";
import { AskAiThread } from "@/components/ai/ask-ai-thread";
import { useAiSession } from "@/lib/ai/session-store";
import { contextFromPath } from "@/lib/ai/thread";
import { useLayer, useOsShell } from "./shell-context";
import { SHELL_LABELS } from "@/lib/nav/labels";

const ICON_BTN = "inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink";

export function OsSidekickPanel() {
  const { sidekickOpen, closeSidekick, consumeSidekickInitialPrompt } = useOsShell();
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const ai = useAiSession();
  const asideRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useLayer(sidekickOpen, { id: "ask-ai-panel", kind: "panel", close: closeSidekick });

  const context = useMemo(() => contextFromPath(pathname), [pathname]);

  // Open: remember who opened it, take a prompt handed over by the caller
  // (the palette's "Ask AI about", a page's Ask AI with a prompt) into the
  // composer, and focus it. Close: focus goes back.
  useEffect(() => {
    if (sidekickOpen) {
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement && !asideRef.current?.contains(active) ? active : null;
      const t = window.setTimeout(() => composerRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    if (back && document.contains(back)) back.focus();
    return undefined;
  }, [sidekickOpen]);
  // A prompt handed over while the panel is open (or as it opens) lands in
  // the composer; consumeSidekickInitialPrompt changes identity with it.
  const { setDraft } = ai;
  useEffect(() => {
    if (!sidekickOpen) return;
    const seed = consumeSidekickInitialPrompt();
    if (seed) {
      setDraft(seed);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }, [sidekickOpen, consumeSidekickInitialPrompt, setDraft]);

  // Tab and Shift+Tab stay inside the open panel.
  function trapTab(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== "Tab" || !asideRef.current) return;
    const focusables = Array.from(
      asideRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function newChat() {
    ai.reset();
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function openFullPage() {
    const href = ai.sessionId ? `/sidekick?session=${ai.sessionId}` : "/sidekick";
    closeSidekick();
    router.push(href);
  }

  return (
    <aside
      ref={asideRef}
      onKeyDown={sidekickOpen ? trapTab : undefined}
      className={`os-chrome flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-app transition-[width] duration-200 ease-out motion-reduce:transition-none ${sidekickOpen ? "w-[360px] border-s border-line" : "w-0"}`}
      inert={!sidekickOpen}
      aria-hidden={!sidekickOpen}
      aria-label={SHELL_LABELS.askAi}
    >
      <div className="flex h-full w-[360px] min-h-0 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
          <h2 className="min-w-0 flex-1 truncate ps-1 text-row font-medium text-ink">{SHELL_LABELS.askAi}</h2>
          <button type="button" className={ICON_BTN} onClick={newChat} title="New chat" aria-label="New chat">
            <Plus className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button type="button" className={ICON_BTN} onClick={openFullPage} title="Open full page" aria-label="Open full page">
            <Maximize2 className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button type="button" className={ICON_BTN} onClick={closeSidekick} title="Close · Esc" aria-label={`Close ${SHELL_LABELS.askAi}`}>
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
        <AskAiThread width="panel" context={context} active={sidekickOpen} composerRef={composerRef} />
      </div>
    </aside>
  );
}
