"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { locales, localeNames, type Locale } from "@/i18n/config";

export function LocaleSwitcher() {
  const current = useLocale() as Locale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const onSelect = (next: Locale) => {
    setOpen(false);
    if (next === current) return;
    startTransition(async () => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      }).catch(() => {});
      router.refresh();
    });
  };

  return (
    <div className="bento-lang-wrap">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change language"
        aria-expanded={open}
        disabled={pending}
        className="bento-lang-btn"
      >
        <span aria-hidden>🌐</span>
        <span className="bento-lang-code">{current.toUpperCase()}</span>
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close language menu"
            className="bento-pop-scrim"
            onClick={() => setOpen(false)}
          />
          <div role="menu" className="bento-pop">
            {locales.map((loc) => (
              <button
                key={loc}
                role="menuitem"
                type="button"
                className={`bento-pop-item${loc === current ? " is-active" : ""}`}
                onClick={() => onSelect(loc)}
              >
                <span className="bento-pop-item-code">{loc.toUpperCase()}</span>
                <span className="bento-pop-item-name">{localeNames[loc]}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <style jsx>{`
        .bento-lang-wrap {
          position: relative;
        }
        .bento-lang-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 12px;
          border-radius: 100px;
          font-size: 12px;
          color: var(--b-t2);
          background: var(--b-card);
          border: 1px solid var(--b-line);
          cursor: pointer;
          font-family: inherit;
          transition: all 0.2s;
        }
        .bento-lang-btn:hover {
          color: var(--b-fg);
          border-color: var(--b-line-2);
        }
        .bento-lang-btn:disabled {
          opacity: 0.5;
          cursor: wait;
        }
        .bento-lang-code {
          font-family: var(--font-geist-mono), monospace;
          letter-spacing: 0.04em;
        }
      `}</style>
    </div>
  );
}
