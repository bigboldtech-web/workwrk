"use client";

// Task system > Tags (the old /settings/tags 308s to /settings/tasks?tab=tags).
// Renders the real tag manager over GET /api/tags. The page it replaces
// showed ten invented sample tags, deleted only locally and read a shape the
// API never returned; this one reads and writes the API, and a failed read
// renders ErrorState with Retry rather than an empty or invented list.

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { TagsManager, type TagRow } from "./tags-manager";
import { tagRowFromApi, type ApiTag } from "@/lib/settings-tabs";


export function TagsTab() {
  const [rows, setRows] = useState<TagRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    const r = await apiFetch<ApiTag[]>("/api/tags?includeArchived=1", { cache: "no-store" });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setRows(Array.isArray(r.data) ? r.data.map(tagRowFromApi) : []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (error) return <ErrorState what="tags" hint={error} onRetry={() => { void load(); }} />;
  if (!rows) return <SkeletonRows rows={5} />;
  return <TagsManager initial={rows} />;
}
