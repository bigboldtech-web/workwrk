"use client";

/* Legal hub — overview of compliance + contracts + IP + privacy. */

import Link from "next/link";
import { Scale, FileSignature, Lock, Shield, ChevronRight, BookOpen } from "lucide-react";

export default function LegalHubPage() {
  return (
    <div className="hub">
      <header className="hub__head">
        <div className="hub__icon" style={{ background: "linear-gradient(135deg, var(--os-c-brown), var(--os-c-purple))" }}><Scale /></div>
        <div>
          <h1>Legal</h1>
          <p>The org's contracts, IP, privacy posture, and policy library — one front door.</p>
        </div>
      </header>

      <div className="hub__grid">
        <Tile href="/legal/contracts" icon={<FileSignature />} hue="var(--os-c-brown)"
          title="Contracts" stat="—" sub="MSAs · NDAs · vendor agreements" />
        <Tile href="/legal/ip" icon={<Lock />} hue="var(--os-c-purple)"
          title="Intellectual property" stat="—" sub="trademarks · copyrights · patents" />
        <Tile href="/legal/privacy" icon={<Shield />} hue="var(--os-c-red)"
          title="Privacy & DPAs" stat="—" sub="DPIA · subprocessors · breach log" />
        <Tile href="/policies" icon={<BookOpen />} hue="var(--os-c-indigo)"
          title="Policies" stat="—" sub="employee ack-tracked" />
      </div>
    </div>
  );
}

function Tile({ href, icon, hue, title, stat, sub }: { href: string; icon: React.ReactNode; hue: string; title: string; stat: string; sub: string }) {
  return (
    <Link href={href} className="hub-tile" style={{ ["--tile-hue" as string]: hue }}>
      <span className="hub-tile__icon">{icon}</span>
      <div className="hub-tile__body">
        <div className="hub-tile__title">{title}</div>
        <div className="hub-tile__stat">{stat}</div>
        <div className="hub-tile__sub">{sub}</div>
      </div>
      <span className="hub-tile__chev"><ChevronRight /></span>
    </Link>
  );
}
