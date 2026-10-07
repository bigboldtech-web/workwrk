"use client";

// Switch — the single toggle used across the OS shell (Customize Inbox,
// Manage cards, Settings, etc.).
//
// IMPORTANT: the track background is set via inline `style`,
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
  /** Why it is off, read on hover. */
  title?: string;
}

// Metrics are fixed pixels (design-system 5: 36 by 20 track, 16px white knob
// inset 2px, 160ms), not rem steps: at the product's 14px root h-5 w-9 drew a
// 31.5 by 17.5 track that the knob overran when on. The off track is
// --os-line-strong, which dark mode rebinds, and focus is the one halo every
// field uses, so nothing here assumes a white page.
export function Switch({ checked, onChange, disabled, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={rest["aria-label"]}
      title={rest.title}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      style={{ backgroundColor: checked ? "var(--os-brand)" : "var(--os-line-strong)" }}
      className={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-colors duration-[160ms] ease-in-out focus:outline-none focus-visible:shadow-[0_0_0_3px_var(--os-focus-halo)] ${
        disabled ? "opacity-50 cursor-default" : "cursor-pointer"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-[16px] w-[16px] rounded-full bg-white ring-1 ring-black/10 transition-transform duration-[160ms] ease-in-out ${
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}
