// Shell for legal pages (Privacy, Terms, Cookies, Do-Not-Sell). They
// share the same structure: a sticky table-of-contents on the left,
// long-form prose on the right. Keeping the styling here means a tweak
// to the legal type scale propagates to every legal doc at once.

import type { ReactNode } from "react";
import {
  Section,
  Container,
  HUES,
  type Hue,
} from "@/components/marketing/primitives";

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

export function LegalPage({
  sections,
  hue = "violet",
}: {
  sections: readonly LegalSection[];
  hue?: Hue;
}) {
  const t = HUES[hue];
  return (
    <Section py="lg">
      <Container>
        <div className="grid lg:grid-cols-[230px_1fr] gap-12 lg:gap-16 items-start">
          {/* Sticky TOC */}
          <nav className="lg:sticky lg:top-24 lg:self-start">
            <p className={`text-xs font-bold uppercase tracking-[0.16em] ${t.text} mb-4`}>On this page</p>
            <ol className="space-y-1.5 text-sm">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="block py-1 text-slate-600 hover:text-slate-900 transition leading-snug"
                  >
                    <span className="text-slate-400 font-mono text-[11px] mr-2">{String(i + 1).padStart(2, "0")}</span>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="space-y-12">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-20">
                <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight mb-5">{s.title}</h2>
                <div className="prose-legal space-y-4 text-[15.5px] text-slate-700 leading-relaxed">
                  {s.body}
                </div>
              </section>
            ))}
          </div>
        </div>
      </Container>
    </Section>
  );
}
