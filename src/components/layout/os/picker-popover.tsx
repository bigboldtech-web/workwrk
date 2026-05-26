"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, Trash2 } from "lucide-react";

export type PickerOption = {
  value: string;
  label: string;
  color: string; // CSS color (background for status / priority)
};

export function OsPickerPopover({
  anchorRect,
  title,
  options,
  activeValue,
  onSelect,
  onClose,
  onClear,
}: {
  anchorRect: DOMRect;
  title: string;
  options: PickerOption[];
  activeValue?: string;
  onSelect: (v: string) => void;
  onClose: () => void;
  onClear?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // close on outside click + escape
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    // delay one tick so the click that opened us doesn't immediately close us
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // place below the anchor; flip up if not enough room
  const top = anchorRect.bottom + 4;
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 268));

  return createPortal(
    <div
      ref={ref}
      className="os-picker workwrk-os"
      style={{ top, left }}
      role="listbox"
      aria-label={title}
    >
      <div className="os-picker__title">{title}</div>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="option"
          aria-selected={o.value === activeValue}
          className={`os-picker__opt ${o.value === activeValue ? "is-active" : ""} ${
            o.color === "none" ? "os-picker__opt--neutral" : ""
          }`}
          style={o.color !== "none" ? { background: o.color } : undefined}
          onClick={() => { onSelect(o.value); onClose(); }}
        >
          {o.label}
        </button>
      ))}
      {onClear ? (
        <>
          <div className="os-picker__div" />
          <button
            type="button"
            className="os-picker__action"
            onClick={() => { onClear(); onClose(); }}
          >
            <Trash2 />
            Clear
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="os-picker__action"
        onClick={onClose}
      >
        <X />
        Cancel
      </button>
    </div>,
    document.body,
  );
}
