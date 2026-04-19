"use client";

import { Reveal } from "@/components/bento/reveal";
import { Scene } from "../scene";

const kudos = [
  {
    from: "Arjun M.",
    to: "Priya S.",
    tag: "Customer Obsession",
    msg: "Stayed up with the Delhi team through the outage. No drama, just fixes.",
    reacts: ["🙌", "🔥", "💚"],
    count: 11,
  },
  {
    from: "Kavita R.",
    to: "Sameer G.",
    tag: "Ownership",
    msg: "Took over the pricing deck without asking. Landed the enterprise account.",
    reacts: ["💯", "🙌"],
    count: 8,
  },
  {
    from: "Ravi K.",
    to: "Nisha P.",
    tag: "Craft",
    msg: "The Q3 ops review deck was the cleanest I have seen. Founders quoted from it.",
    reacts: ["🎯", "💚"],
    count: 14,
  },
  {
    from: "Vikram S.",
    to: "Team · Platform",
    tag: "Team First",
    msg: "Entire platform squad covered the on-call during Diwali. Thank you.",
    reacts: ["🪔", "💚", "🙌", "🔥"],
    count: 22,
  },
];

export function SceneKudos() {
  return (
    <Scene id="kudos">
      <Reveal>
        <div className="scene-kicker">Recognition, measured</div>
      </Reveal>
      <Reveal>
        <h2 className="scene-headline">
          Culture is <span className="hi">what gets rewarded.</span>
        </h2>
      </Reveal>
      <Reveal>
        <p className="scene-sub">
          Peer-to-peer kudos tagged to your company values. Counted on profiles, surfaced in
          reviews, fed into composite scores. Great work stops being invisible.
        </p>
      </Reveal>

      <div className="kudos-wall">
        {kudos.map((k, i) => (
          <Reveal key={`${k.from}-${k.to}`}>
            <div className="kudos-card" style={{ transitionDelay: `${i * 80}ms` }}>
              <div className="kudos-head">
                <span className="kudos-from">{k.from}</span>
                <span className="kudos-arrow">→</span>
                <span className="kudos-to">{k.to}</span>
                <span className="kudos-tag">{k.tag}</span>
              </div>
              <p className="kudos-msg">&ldquo;{k.msg}&rdquo;</p>
              <div className="kudos-reacts">
                <span className="kudos-react-group">
                  {k.reacts.map((r) => (
                    <span key={r} className="kudos-react">
                      {r}
                    </span>
                  ))}
                </span>
                <span className="kudos-count">{k.count} reactions</span>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <style jsx>{`
        .kudos-wall {
          margin-top: 56px;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
        }
        .kudos-card {
          padding: 26px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          display: flex;
          flex-direction: column;
          gap: 14px;
          transition: transform 0.3s, border-color 0.3s;
        }
        .kudos-card:hover {
          transform: translateY(-3px);
          border-color: var(--b-line-2);
        }
        .kudos-head {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 15px;
        }
        .kudos-from {
          color: var(--b-fg-off);
          font-weight: 500;
        }
        .kudos-arrow {
          color: var(--b-t4);
        }
        .kudos-to {
          color: var(--b-fg);
          font-weight: 600;
        }
        .kudos-tag {
          margin-left: auto;
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          padding: 5px 11px;
          border-radius: 100px;
          background: var(--b-card-3);
          color: var(--b-lime);
          font-weight: 600;
        }
        .kudos-msg {
          font-size: 19px;
          line-height: 1.55;
          color: var(--b-fg-off);
          margin: 0;
          font-style: italic;
        }
        .kudos-reacts {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 12px;
          border-top: 1px solid var(--b-line);
        }
        .kudos-react-group {
          display: inline-flex;
          gap: 4px;
        }
        .kudos-react {
          font-size: 20px;
          display: inline-block;
          transition: transform 0.2s;
        }
        .kudos-card:hover .kudos-react {
          transform: scale(1.15);
        }
        .kudos-count {
          font-family: var(--font-geist-mono), monospace;
          font-size: 13px;
          color: var(--b-t2);
          letter-spacing: 0.04em;
        }
        @media (max-width: 720px) {
          .kudos-wall {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </Scene>
  );
}
