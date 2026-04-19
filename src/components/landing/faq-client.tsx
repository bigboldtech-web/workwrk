"use client";

import { useState } from "react";

export type FaqItem = { q: string; a: string };

export function FaqClient({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="faq-grid">
      <aside className="faq-side">
        <span className="bento-label faq-side-label">Questions</span>
        <div>
          <h3 className="faq-side-head">Everything else you wanted to ask.</h3>
          <p className="faq-side-sub">
            Still stuck? The founder reads every email.
          </p>
          <a href="mailto:hi@workwrk.com" className="faq-side-link">
            hi@workwrk.com
          </a>
        </div>
      </aside>

      <div className="faq-list">
        {items.map((it, i) => {
          const isOpen = open === i;
          return (
            <article
              key={it.q}
              className={`faq-item ${isOpen ? "is-open" : ""}`}
            >
              <button
                type="button"
                className="faq-q"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span>{it.q}</span>
                <span className="pl" aria-hidden>+</span>
              </button>
              <div className="faq-a">{it.a}</div>
            </article>
          );
        })}
      </div>

      <style>{`
        .faq-grid {
          display: grid;
          grid-template-columns: repeat(12, 1fr);
          gap: 14px;
        }
        .faq-side {
          grid-column: span 4;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          color: var(--b-fg);
          border-radius: 28px;
          padding: 36px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 280px;
          position: sticky;
          top: 100px;
          height: fit-content;
          overflow: hidden;
        }
        .faq-side-label { color: var(--b-lime); }
        .faq-side-head {
          font-size: 32px;
          font-weight: 600;
          letter-spacing: -0.03em;
          line-height: 1.1;
          margin-top: 14px;
          color: var(--b-fg);
        }
        .faq-side-sub {
          margin-top: 14px;
          font-size: 14.5px;
          line-height: 1.55;
          max-width: 260px;
          color: var(--b-t2);
        }
        .faq-side-link {
          margin-top: 24px;
          font-size: 13.5px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding-bottom: 3px;
          border-bottom: 1px solid var(--b-line-2);
          width: fit-content;
          color: var(--b-lime);
          text-decoration: none;
        }
        .faq-side-link::after {
          content: "→";
          transition: transform 0.2s;
        }
        .faq-side-link:hover { border-bottom-color: var(--b-lime); }
        .faq-side-link:hover::after { transform: translateX(3px); }

        .faq-list {
          grid-column: span 8;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .faq-item {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: 20px;
          overflow: hidden;
          transition: all 0.2s;
        }
        .faq-item:hover { border-color: var(--b-line-2); }
        .faq-item.is-open {
          background: var(--b-card-2);
          border-color: var(--b-lime);
        }
        .faq-q {
          width: 100%;
          text-align: left;
          padding: 22px 26px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 16px;
          font-weight: 500;
          letter-spacing: -0.015em;
          background: transparent;
          border: none;
          color: inherit;
          cursor: pointer;
          font-family: inherit;
        }
        .faq-q .pl {
          width: 26px; height: 26px;
          border-radius: 50%;
          background: var(--b-card-3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          color: var(--b-lime);
          transition: all 0.3s;
          flex-shrink: 0;
        }
        .faq-item.is-open .faq-q .pl {
          background: var(--b-lime);
          color: var(--b-bg);
          transform: rotate(45deg);
        }
        .faq-a {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.4s cubic-bezier(0.2,0.9,0.3,1),
            padding 0.4s cubic-bezier(0.2,0.9,0.3,1);
          color: var(--b-t2);
          font-size: 14px;
          line-height: 1.6;
          padding: 0 26px;
        }
        .faq-item.is-open .faq-a {
          max-height: 400px;
          padding: 4px 26px 22px;
        }

        @media (max-width: 900px) {
          .faq-side, .faq-list { grid-column: span 12; }
          .faq-side { position: static; }
        }
      `}</style>
    </div>
  );
}
