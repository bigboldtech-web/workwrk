"use client";

// useItemFields(listId), which fields this viewer shows on tasks in this List.
//
// spec-task-detail section 3: "returns { visible, toggle } backed by
// UserPreference.home.work.itemFields[listId] with the 'value never hidden'
// rule applied by the caller".
//
// Two things this hook does that a naive read/write would not:
//
//   IT NEVER BLOCKS THE FIRST PAINT. The stored set arrives with the boot
//   payload, which the frame has already fetched, so the strip renders with
//   the viewer's own four fields immediately rather than flashing the
//   defaults and then rearranging.
//
//   A FAILED WRITE REVERTS. `PATCH /api/preferences` is a strict schema: a key
//   it does not know is a 400, not a silent no-op. If the write fails for any
//   reason the local state goes back to what the server still holds, so the
//   checkbox never claims a setting that was not saved (critic #7: settings
//   that never persist).

import { useCallback, useEffect, useState } from "react";
import { useBoot } from "@/components/layout/os/boot-context";
import { apiFetch } from "@/lib/api-fetch";
import {
  DEFAULT_ITEM_FIELDS,
  isItemFieldKey,
  toggleStoredField,
  toggleStoredListField,
  type ItemFieldKey,
} from "@/lib/item-fields";

export interface UseItemFields {
  /** The stored preference, NOT the resolved strip: the caller applies the
   *  value-is-never-hidden rule with resolveVisibleFields. */
  stored: ItemFieldKey[];
  /**
   * The same preference, unfiltered. A List's own custom fields are stored
   * beside the built-ins under one key, so the built-in view has to drop them
   * and the custom-field view has to keep them.
   */
  storedRaw: string[];
  toggle: (key: ItemFieldKey) => void;
  /** Check or uncheck one of the List's custom fields. */
  toggleListField: (key: string) => void;
  /** True while a write is in flight, for an optional saving hint. */
  saving: boolean;
}

export function useItemFields(listId: string | null | undefined): UseItemFields {
  const { boot } = useBoot();
  const fromBoot = listId ? boot.prefs?.home?.work?.itemFields?.[listId] : undefined;
  const [stored, setStored] = useState<string[]>(() => [...(fromBoot ?? DEFAULT_ITEM_FIELDS)]);
  const [saving, setSaving] = useState(false);

  // Follow the List: opening a task in another List must not carry the first
  // List's field set over.
  useEffect(() => {
    setStored([...(fromBoot ?? DEFAULT_ITEM_FIELDS)]);
    // `fromBoot` is a stable array reference from the boot payload; keying on
    // the list id is what actually changes here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  const write = useCallback(
    (next: string[], previous: string[]) => {
      if (!listId) return;
      setStored(next);
      setSaving(true);
      void apiFetch("/api/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ home: { work: { itemFields: { [listId]: next } } } }),
      })
        .then((res) => {
          if (!res.ok) setStored(previous);
        })
        .catch(() => setStored(previous))
        .finally(() => setSaving(false));
    },
    [listId],
  );

  // A built-in toggle rewrites only the built-ins and keeps every custom key.
  const toggle = useCallback(
    (key: ItemFieldKey) => {
      const custom = stored.filter((k) => !isItemFieldKey(k));
      write([...toggleStoredField(stored.filter(isItemFieldKey), key), ...custom], stored);
    },
    [stored, write],
  );

  const toggleListField = useCallback(
    (key: string) => {
      const builtins = stored.filter(isItemFieldKey);
      const custom = toggleStoredListField(stored.filter((k) => !isItemFieldKey(k)), key);
      write([...builtins, ...custom], stored);
    },
    [stored, write],
  );

  return { stored: stored.filter(isItemFieldKey), storedRaw: stored, toggle, toggleListField, saving };
}
