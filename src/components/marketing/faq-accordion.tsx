"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface FaqItem {
  question: string;
  answer: string;
}

interface FaqCategory {
  label: string;
  items: FaqItem[];
}

export function FaqAccordion({ categories }: { categories: FaqCategory[] }) {
  const [openIndex, setOpenIndex] = useState<string | null>(null);

  function toggle(key: string) {
    setOpenIndex((prev) => (prev === key ? null : key));
  }

  return (
    <div className="flex flex-col gap-16">
      {categories.map((cat) => (
        <div key={cat.label}>
          <p className="mkt-label mb-6">{cat.label}</p>

          <div className="rounded-2xl border border-border bg-surface px-6 sm:px-8">
            {cat.items.map((item, i) => {
              const key = `${cat.label}-${i}`;
              const isOpen = openIndex === key;

              return (
                <div
                  key={key}
                  className={`faq-item ${i === cat.items.length - 1 ? "border-b-0" : ""}`}
                  itemScope
                  itemProp="mainEntity"
                  itemType="https://schema.org/Question"
                >
                  <button
                    className="faq-trigger"
                    onClick={() => toggle(key)}
                    aria-expanded={isOpen}
                  >
                    <span itemProp="name">{item.question}</span>
                    <ChevronDown
                      size={20}
                      className="flex-shrink-0 text-muted transition-transform duration-300"
                      style={{
                        transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                      }}
                    />
                  </button>

                  <div
                    className={`faq-answer ${isOpen ? "open" : ""}`}
                    itemScope
                    itemProp="acceptedAnswer"
                    itemType="https://schema.org/Answer"
                  >
                    <p
                      className="text-sm leading-relaxed text-muted"
                      itemProp="text"
                    >
                      {item.answer}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
