// AI prompt library — per-browser localStorage store for user-saved
// prompts. Built-in suggested prompts live in code; this is purely the
// user's personal "favorites" list. Two tabs can share via the storage
// event.

const STORAGE_KEY = "workwrk:ai:saved-prompts";
const EVENT = "workwrk:ai-prompts";
const MAX = 50;

export type SavedPrompt = {
  id: string;
  name: string;
  text: string;
  createdAt: string;
};

function readArr(): SavedPrompt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeArr(arr: SavedPrompt[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(0, MAX)));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function getSavedPrompts(): SavedPrompt[] {
  return readArr();
}

export function saveAIPrompt(name: string, text: string): SavedPrompt {
  const trimmedName = name.trim() || text.slice(0, 60);
  const prompt: SavedPrompt = {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: trimmedName,
    text: text.trim(),
    createdAt: new Date().toISOString(),
  };
  // Newest first, capped to MAX.
  writeArr([prompt, ...readArr()]);
  return prompt;
}

export function removeAIPrompt(id: string) {
  writeArr(readArr().filter((p) => p.id !== id));
}

export function subscribeAIPrompts(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  const storage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", storage);
  };
}
