"use client";

// New group chat (docs/plans/ai-teammates-phase2.md step 4, Decision 13): a
// 480 dialog with a Name and a checklist of the teammates the person can use
// that are on. Two to five may be picked: a sixth box stays off and the field
// says why, and Create with fewer than two says so at the field. A name left
// empty becomes the first three teammates' names (the server's rule). The
// server's own sentence (a removed teammate, two sharing a name, the
// 20-group limit) shows in place, above the buttons.

import { useContext, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { OsShellContext, useLayer } from "@/components/layout/os/shell-context";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SkeletonRows } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { GROUP_LIMITS } from "@/lib/agents/group-chat";
import { GROUP_COPY } from "@/lib/agents/teammate-copy";
import type { GroupDetail } from "@/lib/agents/teammate-thread";
import type { TeammateRow } from "@/lib/agents/teammate-views";
import { cn } from "@/lib/utils";
import { TeammateAvatar } from "./teammate-avatar";

const PRIMARY = "inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4";
const GHOST = "inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink";
const INPUT = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base font-normal text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none";

export function NewGroupDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The person's teammates (the list's rows); null while the list loads. */
  teammates: readonly TeammateRow[] | null;
  /** The list could not be read: say so with Try again, never a skeleton for ever (review round 1). */
  loadFailed?: boolean;
  onRetry?: () => void;
  onCreated: (group: GroupDetail) => void;
}) {
  // Mounted only while open, so every open starts empty.
  if (!props.open) return null;
  return <NewGroupFlow {...props} />;
}

function NewGroupFlow({
  onOpenChange,
  teammates,
  loadFailed = false,
  onRetry,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  teammates: readonly TeammateRow[] | null;
  loadFailed?: boolean;
  onRetry?: () => void;
  onCreated: (group: GroupDetail) => void;
}) {
  const shell = useContext(OsShellContext);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [fieldProblem, setFieldProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const choices = (teammates ?? []).filter((t) => t.status === "ENABLED");
  const full = picked.length >= GROUP_LIMITS.maxMembers;

  useEffect(() => {
    requestAnimationFrame(() => nameRef.current?.focus());
  }, []);

  // A shell layer while open: Esc closes this, never while it saves.
  const savingRef = useRef(saving);
  useEffect(() => {
    savingRef.current = saving;
  });
  useLayer(true, { kind: "dialog", close: () => onOpenChange(false), canClose: () => !savingRef.current });

  function toggle(slug: string) {
    setError(null);
    if (picked.includes(slug)) {
      setFieldProblem(null);
      setPicked(picked.filter((s) => s !== slug));
      return;
    }
    if (picked.length >= GROUP_LIMITS.maxMembers) {
      setFieldProblem(GROUP_COPY.tooMany);
      return;
    }
    setFieldProblem(null);
    setPicked([...picked, slug]);
  }

  async function create() {
    if (saving) return;
    if (picked.length < GROUP_LIMITS.minMembers) {
      setFieldProblem(GROUP_COPY.pickMore);
      return;
    }
    setSaving(true);
    setError(null);
    const r = await apiFetch<{ group: GroupDetail }>("/api/teammate-groups", { method: "POST", json: { name: name.trim() || null, agentSlugs: picked } });
    setSaving(false);
    if (!r.ok) {
      setError(r.code ? r.error : GROUP_COPY.createFailed);
      return;
    }
    onCreated(r.data.group);
  }

  return (
    <Dialog open onOpenChange={(o) => (o || saving ? undefined : onOpenChange(false))}>
      <DialogContent
        className="os-chrome flex max-h-[85vh] max-w-[480px] flex-col gap-0 overflow-hidden border-line bg-raised p-0 text-ink"
        onEscapeKeyDown={(e) => {
          if (!shell) return;
          e.preventDefault();
          shell.closeTopLayer();
        }}
      >
        <div className="flex shrink-0 flex-col gap-1 px-5 pb-3 pt-5 pe-12">
          <DialogTitle className="text-lg font-semibold text-ink">{GROUP_COPY.title}</DialogTitle>
          <DialogDescription className="m-0 text-sm text-ink-2">{GROUP_COPY.intro}</DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-5 py-4">
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5" htmlFor="new-group-name">
              <span className="text-sm font-medium text-ink">{GROUP_COPY.name}</span>
              <input
                id="new-group-name"
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={GROUP_LIMITS.nameMax}
                placeholder={GROUP_COPY.namePlaceholder}
                className={INPUT}
              />
            </label>
            <fieldset className="flex min-w-0 flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium text-ink">{GROUP_COPY.members}</legend>
              {teammates === null && loadFailed ? (
                <p className="m-0 text-sm text-ink-2">
                  {GROUP_COPY.teammatesLoadFailed}
                  {onRetry ? (
                    <>
                      {" · "}
                      <button type="button" onClick={onRetry} className="font-medium text-brand-deep hover:underline">
                        {GROUP_COPY.tryAgain}
                      </button>
                    </>
                  ) : null}
                </p>
              ) : teammates === null ? (
                <SkeletonRows rows={3} rowHeight="44px" />
              ) : choices.length < GROUP_LIMITS.minMembers ? (
                <p className="m-0 text-sm text-ink-2">{GROUP_COPY.needTwo}</p>
              ) : (
                <ul className="flex flex-col rounded-md border border-line">
                  {choices.map((t) => {
                    const on = picked.includes(t.slug);
                    const off = !on && full;
                    return (
                      <li key={t.slug} className="border-b border-line last:border-b-0">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          aria-disabled={off || undefined}
                          onClick={() => toggle(t.slug)}
                          className={cn("flex h-11 w-full min-w-0 items-center gap-3 px-3 text-start hover:bg-hover", off && "opacity-60")}
                        >
                          <span
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                              on ? "border-brand bg-brand text-white" : "border-line-strong bg-raised",
                            )}
                            aria-hidden
                          >
                            {on ? <Check className="h-3 w-3" strokeWidth={2.5} /> : null}
                          </span>
                          <TeammateAvatar name={t.name} hue={t.hue} avatar={t.avatar} size="md" />
                          <span className="min-w-0 shrink-0 text-base text-ink">{t.name}</span>
                          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{t.job}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {fieldProblem ? (
                <p role="alert" className="m-0 text-sm text-danger-text">
                  {fieldProblem}
                </p>
              ) : null}
            </fieldset>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 border-t border-line px-5 py-3">
          {error ? (
            <p role="alert" className="m-0 text-sm text-danger-text">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={GHOST} disabled={saving} onClick={() => onOpenChange(false)}>
              {GROUP_COPY.cancel}
            </button>
            <button type="button" className={PRIMARY} disabled={saving} onClick={() => void create()}>
              {GROUP_COPY.create}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
