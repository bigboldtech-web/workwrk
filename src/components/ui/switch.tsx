"use client";

// Switch — the single toggle used across the OS shell (Customize Inbox,
// Manage cards, Settings, etc.).
//
// IMPORTANT: the track background + border are set via inline `style`,
// not Tailwind classes. The OS shell has a global reset
//   .workwrk-os button { background: none; border: none; padding: 0 }
// whose selector outranks Tailwind `bg-*`/`border-*` utilities, so a
// class-based track silently renders transparent (the "invisible
// toggle" bug). Inline styles beat that non-!important rule.

interface SwitchProps {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Switch({ checked, onChange, disabled, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={rest["aria-label"]}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      style={{
        backgroundColor: checked ? "var(--os-brand)" : "#e4e4e7",
        border: checked ? "1px solid var(--os-brand)" : "1px solid #d4d4d8",
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
        disabled ? "opacity-50 cursor-default" : "cursor-pointer"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200 ease-in-out ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
