"use client";

// The @-typeahead, extracted (spec-task-detail section 3 `MentionTypeahead`).
//
// It lived inside item-thread.tsx and nowhere else, so the task description
// could not have mentions at all and the create-task modal's description could
// not either. It is a hook plus a popover rather than a wrapper component,
// because the two callers own their own textarea (one autosaves, one posts)
// and neither can give it up.
//
// What it promises the server: only mentions whose "@First Last" token is
// STILL IN THE TEXT when the body is sent are reported. Editing a name out of
// a draft must un-invite that person, or a mention notification arrives for a
// message that never names them.
//
// Source: GET /api/users?scope=all. spec-task-detail names GET
// /api/people/pick, which the access unit has not shipped yet; when it lands,
// this is the one call site to move.

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { Picker, type PickerSectionDef } from "@/components/ui/picker";
import { Avatar, personLabel, type AvatarPerson } from "@/components/ui/avatar-stack";
import { detectMention, type MentionRef } from "@/lib/mention-token";

export { surviving } from "@/lib/mention-token";
export type { MentionRef } from "@/lib/mention-token";

export interface UseMentionTypeahead {
  /** Render this inside a `relative` wrapper around the textarea. */
  popover: React.ReactNode;
  /** Call on every change, with the new value. */
  onValueChange: (value: string) => void;
  /** Call from the textarea's onKeyDown FIRST; true means it was handled. */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Call on click and on selection change to re-sync the token. */
  onCaretMove: () => void;
  /** Everyone who has been inserted into this draft so far. */
  mentions: MentionRef[];
  /** After a successful post: forget the draft's mentions. */
  reset: () => void;
  open: boolean;
  close: () => void;
}

export function useMentionTypeahead({
  value,
  setValue,
  textareaRef,
  enabled = true,
  side = "bottom",
  boardId = null,
}: {
  value: string;
  setValue: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  enabled?: boolean;
  side?: "bottom" | "top";
  /** The List this text belongs to. Scopes who can be @-mentioned to the
   *  people who can actually reach it; without it this falls back to
   *  /api/users, which answers a non-exec caller with their own report tree
   *  and nobody else, so the typeahead found zero matches for a colleague the
   *  assignee picker on the same task lists happily. */
  boardId?: string | null;
}): UseMentionTypeahead {
  const [token, setToken] = useState<{ start: number; query: string } | null>(null);
  const [people, setPeople] = useState<AvatarPerson[]>([]);
  const [mentions, setMentions] = useState<MentionRef[]>([]);
  // The caret never leaves the textarea while the typeahead is open, so this
  // hook answers the arrow keys and the Picker only draws where they got to.
  const [activeIdx, setActiveIdx] = useState(0);

  const open = enabled && token !== null;
  const query = token?.query ?? "";

  useEffect(() => {
    // Closed: nothing to fetch. The list is cleared by `close()`, which is
    // the only way the token goes away, so nothing has to be cleared here.
    if (!open) return;
    let live = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ limit: "8" });
      if (query.trim()) params.set("search", query.trim());
      if (!boardId) params.set("scope", "all");
      const url = boardId
        ? `/api/boards/${encodeURIComponent(boardId)}/assignable?${params}`
        : `/api/users?${params}`;
      fetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((d) => {
          if (!live) return;
          setPeople(Array.isArray(d?.data) ? d.data : []);
          setActiveIdx(0);
        })
        .catch(() => {
          if (live) setPeople([]);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, query, boardId]);

  const close = useCallback(() => {
    setToken(null);
    setPeople([]);
  }, []);

  const sync = useCallback(
    (next: string) => {
      if (!enabled) return;
      const caret = textareaRef.current?.selectionStart ?? next.length;
      setToken(detectMention(next, caret));
    },
    [enabled, textareaRef],
  );

  const onValueChange = useCallback(
    (next: string) => {
      setValue(next);
      sync(next);
    },
    [setValue, sync],
  );

  const onCaretMove = useCallback(() => sync(value), [sync, value]);

  const pick = useCallback(
    (person: AvatarPerson) => {
      if (!token) return;
      const el = textareaRef.current;
      const current = value;
      const caret = el?.selectionStart ?? token.start + 1 + token.query.length;
      const name = personLabel(person);
      const next = `${current.slice(0, token.start)}@${name} ${current.slice(caret)}`;
      setValue(next);
      setMentions((prev) => (prev.some((m) => m.id === person.id && m.name === name) ? prev : [...prev, { id: person.id, name }]));
      close();
      const pos = token.start + name.length + 2; // past "@Name "
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    },
    [token, textareaRef, setValue, close, value],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open || people.length === 0) return false;
      // Escape is caught before it can reach the drawer's own Esc handler:
      // closing a typeahead must never close the task behind it.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return true;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % people.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + people.length) % people.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(people[activeIdx] ?? people[0]);
        return true;
      }
      return false;
    },
    [open, people, activeIdx, pick, close],
  );

  const sections: PickerSectionDef[] = useMemo(
    () => [
      {
        options: people.map((p) => ({
          value: p.id,
          label: personLabel(p),
          keywords: p.email ?? "",
          glyph: <Avatar person={p} size={20} />,
        })),
      },
    ],
    [people],
  );

  const popover = open && people.length > 0 ? (
    <Picker
      open
      onClose={close}
      sections={sections}
      onSelect={(id) => {
        const person = people.find((p) => p.id === id);
        if (person) pick(person);
      }}
      side={side}
      ariaLabel="Mention someone"
      alwaysSearch={false}
      autoFocusList={false}
      backdrop={false}
      activeValue={people[activeIdx]?.id ?? null}
      emptyLabel="Nobody matches"
    />
  ) : null;

  return {
    popover,
    onValueChange,
    onKeyDown,
    onCaretMove,
    mentions,
    reset: () => setMentions([]),
    open,
    close,
  };
}
