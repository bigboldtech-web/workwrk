"use client";

/**
 * A chip list of sites or apps with an Add field: the settings pages' chip
 * list (settings-form.tsx ChipsInput's own chips and field). Moved here from
 * Apps & modules' Computer for AI teammates section
 * (teammate-browser-section.tsx) for the AI apps (MCP) section beside it
 * (docs/plans/mcp-server.md 6.3), which draws the same list.
 *
 * Each change is its own call (onChange) rather than a whole list, so the
 * section decides how it saves, and says what is wrong with an entry under
 * the field (the route parses what is typed: a pasted address gives its
 * host). The words besides the heading and hint come from the section's own
 * copy (`words`), so this draws no sentence of its own.
 *
 * The hint is one line (settings-cleanup B6); anything longer is `more`,
 * behind the shared Show more link under it.
 */

import { useId, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { btn, FieldError, TextInput } from "@/components/account/account-ui";
import { cn } from "@/lib/utils";
import { SettingsMore } from "./settings-more";

/** The list's own words: its Add button, the field's placeholder, and each chip's Remove label. */
export interface SiteChipsWords {
  addSite: string;
  addPlaceholder: string;
  remove: (site: string) => string;
}

export function SiteChips<L extends string>({
  list,
  heading,
  hint,
  more,
  sites,
  onChange,
  words,
}: {
  list: L;
  heading: string;
  /** One line under the heading. */
  hint: string;
  /** Longer help behind the Show more link, under the hint. */
  more?: ReactNode;
  sites: readonly string[];
  onChange: (list: L, change: { add: string } | { remove: string }) => Promise<string | null>;
  words: SiteChipsWords;
}) {
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const errId = useId();

  async function add() {
    const v = draft.trim();
    if (!v || busy) return;
    setBusy(true);
    const problem = await onChange(list, { add: v });
    setBusy(false);
    setErr(problem);
    if (!problem) setDraft("");
  }

  async function remove(site: string) {
    // Held while a change saves (final Settings review, M4): the x stays
    // focusable (aria-disabled), so the click is refused here instead.
    if (busy) return;
    setBusy(true);
    const problem = await onChange(list, { remove: site });
    setBusy(false);
    setErr(problem);
  }

  return (
    <div>
      <label htmlFor={inputId} className="block text-base font-medium text-ink">{heading}</label>
      <p className="mt-0.5 text-sm text-ink-2">{hint}</p>
      {more ? <SettingsMore className="mt-0.5" about={heading}>{more}</SettingsMore> : null}
      {sites.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={heading}>
          {sites.map((site) => (
            <li key={site} className="inline-flex h-6 items-center gap-1 rounded-full border border-line bg-hover ps-2.5 pe-1 text-sm text-ink">
              <span className="break-all">{site}</span>
              <button
                type="button"
                onClick={() => void remove(site)}
                aria-disabled={busy || undefined}
                aria-label={words.remove(site)}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-3 hover:bg-active hover:text-ink aria-disabled:opacity-50"
              >
                <X className="h-3 w-3" strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <TextInput
          id={inputId}
          value={draft}
          placeholder={words.addPlaceholder}
          invalid={!!err}
          aria-describedby={err ? errId : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { setDraft(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
        />
        <button type="button" onClick={() => void add()} disabled={!draft.trim() || busy} className={cn(btn.secondary, "shrink-0 whitespace-nowrap")}>
          {words.addSite}
        </button>
      </div>
      <FieldError id={errId}>{err}</FieldError>
    </div>
  );
}
