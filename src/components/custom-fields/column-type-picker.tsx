"use client";

// ColumnTypePicker — Phase 8. Visual grid for choosing a custom-field
// type. Matches monday's "Search or describe your column" popover:
// two sections (Essentials, Super useful), each tile shows a coloured
// icon chip + the label.

import {
  Type, AlignLeft, Hash, Calendar, CheckSquare, ListChecks,
  ChevronDown, Link as LinkIcon, Mail, type LucideIcon,
} from "lucide-react";

type FieldType = "TEXT" | "TEXTAREA" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT" | "MULTI_SELECT" | "URL" | "EMAIL";

interface Option {
  id: FieldType;
  label: string;
  tagline: string;
  Icon: LucideIcon;
  hue: "blue" | "green" | "amber" | "violet" | "pink" | "teal" | "sky" | "rose";
  group: "essentials" | "super";
}

const OPTIONS: Option[] = [
  // Essentials — the most common column types in monday's picker.
  { id: "SELECT", label: "Status", tagline: "Single-choice tag", Icon: ChevronDown, hue: "green", group: "essentials" },
  { id: "MULTI_SELECT", label: "Dropdown", tagline: "Multi-choice tags", Icon: ListChecks, hue: "blue", group: "essentials" },
  { id: "TEXT", label: "Text", tagline: "Short free-form", Icon: Type, hue: "amber", group: "essentials" },
  { id: "DATE", label: "Date", tagline: "Calendar picker", Icon: Calendar, hue: "violet", group: "essentials" },
  { id: "NUMBER", label: "Number", tagline: "Quantity, score, count", Icon: Hash, hue: "teal", group: "essentials" },

  // Super useful.
  { id: "CHECKBOX", label: "Checkbox", tagline: "Yes / no toggle", Icon: CheckSquare, hue: "sky", group: "super" },
  { id: "TEXTAREA", label: "Long text", tagline: "Paragraph", Icon: AlignLeft, hue: "rose", group: "super" },
  { id: "URL", label: "Link", tagline: "URL to a page", Icon: LinkIcon, hue: "blue", group: "super" },
  { id: "EMAIL", label: "Email", tagline: "Mailto address", Icon: Mail, hue: "pink", group: "super" },
];

const HUE_TONE: Record<Option["hue"], string> = {
  blue: "bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-300 border-blue-200/40",
  green: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-300 border-emerald-200/40",
  amber: "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-300 border-amber-200/40",
  violet: "bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-300 border-violet-200/40",
  pink: "bg-pink-50 dark:bg-pink-950/30 text-pink-600 dark:text-pink-300 border-pink-200/40",
  teal: "bg-teal-50 dark:bg-teal-950/30 text-teal-600 dark:text-teal-300 border-teal-200/40",
  sky: "bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-300 border-sky-200/40",
  rose: "bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-300 border-rose-200/40",
};

interface Props {
  value: FieldType;
  onChange: (next: FieldType) => void;
  /** Filter visible options by free-text search (matches label/tagline). */
  query?: string;
}

export function ColumnTypePicker({ value, onChange, query }: Props) {
  const q = (query ?? "").trim().toLowerCase();
  const filtered = q
    ? OPTIONS.filter((o) => o.label.toLowerCase().includes(q) || o.tagline.toLowerCase().includes(q))
    : OPTIONS;

  const essentials = filtered.filter((o) => o.group === "essentials");
  const sup = filtered.filter((o) => o.group === "super");

  return (
    <div className="space-y-4">
      {essentials.length > 0 && (
        <Section title="Essentials" options={essentials} value={value} onChange={onChange} />
      )}
      {sup.length > 0 && (
        <Section title="Super useful" options={sup} value={value} onChange={onChange} />
      )}
      {filtered.length === 0 && (
        <p className="text-xs text-muted-2 text-center py-6">No matches</p>
      )}
    </div>
  );
}

function Section({
  title, options, value, onChange,
}: {
  title: string;
  options: Option[];
  value: FieldType;
  onChange: (next: FieldType) => void;
}) {
  return (
    <section>
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-2 mb-2 px-1">{title}</h4>
      <div className="grid grid-cols-2 gap-1.5">
        {options.map((o) => {
          const Icon = o.Icon;
          const active = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className={
                "flex items-center gap-2.5 p-2.5 rounded-lg border transition-all text-left " +
                (active
                  ? "border-violet-400 bg-violet-50/50 dark:bg-violet-950/30 ring-1 ring-violet-300/40"
                  : "border-border hover:border-muted-2 hover:bg-surface-2")
              }
              aria-pressed={active}
            >
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md border ${HUE_TONE[o.hue]}`}>
                <Icon size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-foreground truncate">{o.label}</span>
                <span className="block text-[10px] text-muted-2 truncate">{o.tagline}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
