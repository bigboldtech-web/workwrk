// The foundations preview.
//
// Stage A ships no public page. It ships the parts every later stage builds
// out of: the fixture, the pricing source, the marketing shell and its
// surfaces, the Receipt and the OG route. A part nobody has looked at is not
// done, so this route renders each of them once, at full size and scaled, so
// they can be screenshotted, reviewed and regression checked.
//
// It is not a destination: it returns a 404 in production, exactly as the
// loader preview does, and it is not in the sitemap or in any nav.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MarketingShell, MIN_LEGIBLE_SCALE } from "@/components/marketing/shell/marketing-shell";
import {
  AskAiSurface,
  BoardListSurface,
  GoalDetailSurface,
  MkSidebar,
  MyWorkSurface,
  PlannerWeekSurface,
  RolePageSurface,
  SopDocSurface,
  TableSurface,
  TalkThreadSurface,
  TemplateCenterSurface,
  ContractDocSurface,
  InviteModalSurface,
  ReviewTimelineSurface,
} from "@/components/marketing/shell/surfaces";
import { BrandDot } from "@/components/marketing/shell/primitives";
import { Receipt } from "@/components/marketing/receipt/receipt";
import { stackReceiptModel, workReceiptModel } from "@/components/marketing/receipt/receipt-model";
import { narrationFor, replacesTag, tuesday } from "@/components/marketing/data/tuesday";
import { categoryLabel, formatMoney, pricing, startFreeSubline, tierPerSeat } from "@/components/marketing/data/pricing";
import { PrimaryCta, SecondaryCta } from "@/components/marketing/cta";

export const metadata: Metadata = {
  title: "Foundations preview",
  robots: { index: false, follow: false },
};

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mk-section" style={{ paddingBlock: 40 }}>
      <h2 className="mk-title-lg" style={{ marginBottom: 6 }}>
        {title}
      </h2>
      {note ? (
        <p className="mk-body" style={{ margin: "0 0 20px", color: "var(--os-ink-2)", maxWidth: 720 }}>
          {note}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export default function FoundationsPreview() {
  if (process.env.NODE_ENV === "production") notFound();

  const stack = stackReceiptModel({
    selected: ["task-tracker", "wiki", "team-chat", "okr-tool", "review-tool"],
    seats: 50,
    currency: "USD",
  });

  return (
    <div>
      <section className="mk-section" style={{ paddingBottom: 24 }}>
        <p className="mk-label" style={{ color: "var(--os-ink-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Stage A
        </p>
        <h1 className="mk-display-lg" style={{ marginBlock: "8px 16px" }}>
          Your people, processes, work and goals. Snapped together.
        </h1>
        <p className="mk-body" style={{ margin: 0, maxWidth: 640, color: "var(--os-ink-2)" }}>
          Roles own SOPs. SOPs become tasks. Tasks move goals. One system, no tabs in between, no training.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24, alignItems: "center" }}>
          <PrimaryCta placement="preview-hero" template />
          <SecondaryCta placement="preview-hero" />
          <span className="mk-caption" style={{ color: "var(--os-ink-2)" }}>
            {startFreeSubline()}
          </span>
        </div>
      </section>

      <Block
        title="The shell, full size"
        note="Navy rail and navy top bar framing a white canvas, a light grey secondary sidebar, and exactly one blue button. Everything here is DOM on the product's own tokens, so it resizes and stays legible at 14px."
      >
        <MarketingShell
          hub="work"
          breadcrumb={["Work", "My work"]}
          clock="8:47 AM"
          sidebar={<MkSidebar hub="work" />}
          label="The WorkwrK shell at 8:47, showing My work with one task already waiting."
        >
          <MyWorkSurface showTaskCaption />
        </MarketingShell>
      </Block>

      <Block
        title="Two surfaces, side by side"
        note="The grammar every stop of the story uses: two blocks, two real surfaces, one connection between them."
      >
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))" }}>
          <MarketingShell
            hub="teams"
            breadcrumb={["Teams", "Roles", tuesday.role.title]}
            clock="9:02"
            label="The role definition page for the Onboarding lead, carrying its KRA and its KPI."
            caption={null}
            scale={0.72}
            width={1180}
            height={620}
          >
            <RolePageSurface />
          </MarketingShell>
          <MarketingShell
            hub="docs"
            breadcrumb={["Docs", "SOPs", tuesday.sop.title]}
            clock="9:03"
            label="The SOP, owned by a role, with step 3 attached to the onboarding cycle time KPI."
            caption={null}
            scale={0.72}
            width={1180}
            height={620}
          >
            <SopDocSurface />
          </MarketingShell>
        </div>
        <p className="mk-caption" style={{ marginTop: 10, color: "var(--os-ink-2)" }}>
          {narrationFor(tuesday.stops[0])}
        </p>
      </Block>

      <Block
        title="Every surface the story needs"
        note="All thirteen marketing-lite surfaces, each one rendered from the same fixture the trial template will carry. None of them is a screenshot. Each tile sits at the 0.72 legibility floor, so the product's 14px is still the product's 14px, and each one re-lays itself out to the width of its column rather than being cropped to it."
      >
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(min(460px, 100%), 1fr))" }}>
          {[
            { hub: "work", crumbs: ["Work", "Onboarding"], clock: "9:04", node: <BoardListSurface drawer />, label: "The Onboarding board with the task drawer open." },
            { hub: "talk", crumbs: ["Talk", "#onboarding"], clock: "10:30", node: <TalkThreadSurface />, label: "The onboarding channel, where the reporting decision is made." },
            { hub: "planner", crumbs: ["Planner", "My week"], clock: "2:15", node: <PlannerWeekSurface />, label: "The planner week with the 15 minute finance call." },
            { hub: "goals", crumbs: ["Goals", "Q3"], clock: "4:45", node: <GoalDetailSurface />, label: "The goal at 64 percent with its effort card and verdict." },
            { hub: "tables", crumbs: ["Tables", "Clients"], clock: "9:02", node: <TableSurface />, label: "The Clients table, where row 41 was written by the signed form." },
            { hub: "ai", crumbs: ["AI", "Ask"], clock: "6:02", node: <AskAiSurface />, label: "Ask AI answering from four sources, one per block it read." },
            { hub: "work", crumbs: ["Work", "Templates"], clock: "Day one", node: <TemplateCenterSurface />, label: "Template Center with the Tuesday workspace as the first tile." },
            { hub: "docs", crumbs: ["Docs", "Contracts"], clock: "11:15", node: <ContractDocSurface />, label: "Contract v2 with the reporting clause, attached to the task." },
            { hub: "teams", crumbs: ["Teams", "Reviews"], clock: "6:02", node: <ReviewTimelineSurface />, label: "Sam's review timeline, with the kudos landing as evidence." },
            { hub: "teams", crumbs: ["Teams", "Members"], clock: "Day one", node: <InviteModalSurface />, label: "The invite modal, the first thing a new workspace does." },
          ].map((s, i) => (
            <MarketingShell
              key={i}
              hub={s.hub}
              breadcrumb={s.crumbs}
              clock={s.clock}
              label={s.label}
              caption={null}
              scale={MIN_LEGIBLE_SCALE}
              width={1180}
              height={640}
            >
              {s.node}
            </MarketingShell>
          ))}
        </div>
      </Block>

      <Block
        title="Both receipts"
        note="One component, two receipts. The Work Receipt is what you get. The Stack Receipt is what you keep. They rhyme on purpose."
      >
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", alignItems: "start" }}>
          <Receipt model={workReceiptModel()} />
          <Receipt model={stack} />
        </div>
      </Block>

      <Block title="The eight blocks and what each replaces">
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))" }}>
          {tuesday.hubs.map((h) => (
            <li
              key={h.id}
              style={{
                border: "1px solid var(--os-line)",
                borderRadius: "var(--os-r-md)",
                padding: 14,
                background: "var(--os-canvas)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <BrandDot color={h.dot} />
                <span className="mk-label">{h.label}</span>
              </span>
              <p className="mk-caption" style={{ margin: "6px 0 0", color: "var(--os-ink-2)" }}>
                Replaces: {replacesTag(h, categoryLabel)}
              </p>
            </li>
          ))}
        </ul>
      </Block>

      <Block
        title="The pricing source"
        note={`One JSON feeds the receipt, the cards and the JSON-LD. List prices dated ${pricing.asOfLabel}.`}
      >
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))" }}>
          {pricing.tiers.map((t) => {
            const perSeat = tierPerSeat(t.id, "USD");
            return (
              <div
                key={t.id}
                style={{
                  border: t.recommended ? "1px solid var(--os-brand)" : "1px solid var(--os-line)",
                  borderRadius: "var(--os-r-md)",
                  padding: 16,
                  background: "var(--os-canvas)",
                }}
              >
                <div className="mk-label">{t.name}</div>
                <div className="mk-title-lg mk-figures" style={{ marginBlock: 6 }}>
                  {perSeat === null ? "Custom" : perSeat === 0 ? "Free" : formatMoney(perSeat, "USD")}
                </div>
                <p className="mk-caption" style={{ margin: 0, color: "var(--os-ink-2)" }}>
                  {t.priceSubLabel}
                </p>
              </div>
            );
          })}
        </div>
      </Block>
    </div>
  );
}
