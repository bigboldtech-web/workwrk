"use client";

// ColumnTypePicker (spec-tables-forms section 3): the seventeen column types on
// the one Picker (design system 5.6), ten rows and a "Show more" footer that
// reveals the other seven (design system 5.1: Show more after 10). Opened from
// the column menu's "Column type" row and, later, the Data menu and the CSV
// import dialog.
//
// Pure UI: choosing a type calls onChange. What a change means (the confirm
// naming how many cells change, keeping the old values in a new Text column,
// the options editor, the formula editor, the relation dialog) is the
// page's, because the page owns the columns and the undo stack.

import { useState } from "react";
import {
  AlignLeft, Calendar, CheckSquare, CircleDot, Combine, DollarSign, Hash, Link, Link2,
  ListChecks, Mail, Paperclip, Percent, ScanSearch, Sigma, Star, Type, User,
  type LucideIcon,
} from "lucide-react";
import { Picker, PickerFooterRow } from "@/components/ui/picker";
import { COLUMN_TYPE_CHOICES, type ColumnTypeValue } from "@/lib/sheet-columns";

// Single select is CircleDot (one radio pick), never ChevronDown: the column
// header draws this glyph inside its drag handle, next to the real column menu
// button, which is a ChevronDown. A chevron here read as a second menu door
// that opened nothing.
export const COLUMN_TYPE_ICON: Record<string, LucideIcon> = {
  short_text: Type,
  long_text: AlignLeft,
  number: Hash,
  currency: DollarSign,
  percent: Percent,
  date: Calendar,
  checkbox: CheckSquare,
  select: CircleDot,
  multi_select: ListChecks,
  rating: Star,
  person: User,
  url: Link,
  attachment: Paperclip,
  formula: Sigma,
  link: Link2,
  lookup: ScanSearch,
  rollup: Combine,
  email: Mail,
};

export function ColumnTypePicker({
  open, onClose, value, onChange, anchorPoint,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (next: ColumnTypeValue) => void;
  anchorPoint: { top: number; left: number } | null;
}) {
  // Start expanded when the column already holds one of the seven, so the
  // current type is never hidden behind "Show more".
  const currentIsMore = COLUMN_TYPE_CHOICES.some((c) => c.value === value && c.more) || value === "email";
  const [expanded, setExpanded] = useState(currentIsMore);

  const option = (v: string, label: string) => {
    const Icon = COLUMN_TYPE_ICON[v] ?? Type;
    return { value: v, label, glyph: <Icon className="h-4 w-4 text-ink-2" aria-hidden /> };
  };
  const primary = COLUMN_TYPE_CHOICES.filter((c) => !c.more).map((c) => option(c.value, c.label));
  const more = COLUMN_TYPE_CHOICES.filter((c) => c.more).map((c) => option(c.value, c.label));
  // Email is not offered as a new type, but a column that already is one
  // shows it, checked, so the picker never misreports the column.
  if (value === "email") more.unshift(option("email", "Email"));

  const sections = expanded ? [{ options: primary }, { options: more }] : [{ options: primary }];

  return (
    <Picker
      open={open}
      onClose={onClose}
      sections={sections}
      selected={value}
      onSelect={(v) => onChange(v as ColumnTypeValue)}
      ariaLabel="Column type"
      searchPlaceholder="Search types…"
      anchorPoint={anchorPoint}
      footer={expanded ? undefined : (
        <PickerFooterRow onClick={() => setExpanded(true)}>Show more</PickerFooterRow>
      )}
    />
  );
}
