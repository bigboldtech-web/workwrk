"use client";

// The report recipient picker: org members, by id, and nothing else.
//
// It reads GET /api/report-schedules/recipient-options, which applies the
// server's own recipient rule (this org, live, not INACTIVE, not a Guest), so
// the picker can never offer someone the save would refuse. Searching asks
// ?q=; the chips already chosen are named through ?ids=, eligible or not, so
// a colleague who went inactive shows as a greyed chip ("No longer receives
// reports") the sender can remove. There is no free-text field: a report is
// computed under a member's access, and an address box would mail that
// wherever someone typed. Not /api/users or /api/people/pick, which answer
// "who can I see", a different question.

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Picker } from "@/components/ui/picker";
import { Avatar } from "@/components/ui/avatar-stack";
import { cn } from "@/lib/utils";

export interface RecipientOption {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  email: string | null;
  eligible: boolean;
}

const MAX = 100;

function nameOf(p: Pick<RecipientOption, "firstName" | "lastName" | "email">): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Someone";
}

async function readOptions(qs: string): Promise<RecipientOption[] | null> {
  try {
    const res = await fetch(`/api/report-schedules/recipient-options?${qs}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { people?: RecipientOption[] };
    return body.people ?? [];
  } catch {
    return null;
  }
}

export function RecipientPicker({
  value,
  onChange,
  locked,
  keepId,
  disabled,
  onOpenChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /**
   * A private view goes to its owner only, so nobody can be ADDED. Removing
   * stays possible: a view made private after it was scheduled to colleagues
   * still lists them, and the save that trims them has to be reachable. Those
   * chips show greyed, since the report no longer reaches them.
   */
  locked?: boolean;
  /** Under `locked`, the owner: the one chip that cannot be removed. */
  keepId?: string | null;
  disabled?: boolean;
  /** Told when the list opens and closes, so a clipping host can make room. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    onOpenChange?.(open);
    // Only the open state is reported; a new callback identity is not news.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<RecipientOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [known, setKnown] = useState<Map<string, RecipientOption>>(new Map());
  const seq = useRef(0);

  const remember = (people: readonly RecipientOption[]) =>
    setKnown((prev) => {
      const next = new Map(prev);
      for (const p of people) next.set(p.id, p);
      return next;
    });

  // Name every chosen id, eligible or not.
  const key = value.join(",");
  useEffect(() => {
    const missing = value.filter((id) => !known.has(id));
    if (missing.length === 0) return;
    let live = true;
    void (async () => {
      const people = await readOptions(`ids=${missing.map(encodeURIComponent).join(",")}&limit=1`);
      if (live && people) remember(people);
    })();
    return () => {
      live = false;
    };
    // `key` is the content of `value`; `known` is read, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // The search page, while the picker is open.
  useEffect(() => {
    if (!open) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      void (async () => {
        const people = await readOptions(`limit=20${q ? `&q=${encodeURIComponent(q)}` : ""}`);
        if (n !== seq.current) return;
        if (!people) {
          setFailed(true);
          setRows([]);
          return;
        }
        setFailed(false);
        setRows(people);
        remember(people);
      })();
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [open, q]);

  const removable = (id: string) => !disabled && !(locked && id === keepId);
  const toggle = (id: string) => {
    if (value.includes(id)) {
      if (removable(id)) onChange(value.filter((x) => x !== id));
    } else if (!locked && value.length < MAX) onChange([...value, id]);
  };

  const options = useMemo(
    () =>
      (rows ?? []).map((p) => ({
        value: p.id,
        label: nameOf(p),
        description: p.email ?? undefined,
        keywords: p.email ?? undefined,
        glyph: <Avatar person={p} size={20} />,
        disabled: !value.includes(p.id) && value.length >= MAX,
      })),
    [rows, value],
  );

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {value.map((id) => {
        const p = known.get(id);
        // On a private view anyone but its owner is skipped by every run.
        const barred = !!locked && !!keepId && id !== keepId;
        const ineligible = barred || (p ? !p.eligible : false);
        return (
          <span
            key={id}
            title={barred ? "Doesn't receive a private view" : ineligible ? "No longer receives reports" : undefined}
            className={cn(
              "inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-md border border-line ps-1 pe-1 text-sm",
              ineligible ? "bg-subtle text-ink-3" : "bg-raised text-ink",
            )}
          >
            {p ? <Avatar person={p} size={20} className={ineligible ? "opacity-50" : ""} /> : <span className="inline-block h-5 w-5 rounded-full bg-skeleton" aria-hidden />}
            <span className={cn("min-w-0 truncate", ineligible && "line-through")}>{p ? nameOf(p) : "Someone"}</span>
            {removable(id) ? (
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-label={`Remove ${p ? nameOf(p) : "this person"}`}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink"
              >
                <X className="h-3 w-3" strokeWidth={1.5} aria-hidden />
              </button>
            ) : null}
          </span>
        );
      })}
      {!locked ? (
        <span className="relative inline-flex">
          <button
            type="button"
            disabled={disabled || value.length >= MAX}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:text-ink-4"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
            Add people
          </button>
          <Picker
            open={open}
            onClose={() => {
              setOpen(false);
              setQ("");
            }}
            multi
            alwaysSearch
            ariaLabel="Recipients"
            searchPlaceholder="Search people in this workspace"
            selected={value}
            onSearchChange={setQ}
            loading={rows === null}
            emptyLabel={failed ? "Couldn't load people. Close and try again." : q ? "No one matches" : "No one to add"}
            sections={[{ options }]}
            width={300}
            onSelect={toggle}
          />
        </span>
      ) : null}
    </div>
  );
}
