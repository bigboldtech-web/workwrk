// Window events for the AI hub. Each surface that changes a chat (the page,
// the panel, the sidebar's own row menu) dispatches this; the AI hub sidebar
// refetches /api/ai/sidebar on it. No poller.
export const AI_CHATS_CHANGED_EVENT = "workwrk:ai-chats-changed";

export function notifyAiChatsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(AI_CHATS_CHANGED_EVENT));
}
