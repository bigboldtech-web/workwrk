// The compare data, held to the discipline the pages are written under.
//
// This file lives under /compare with the data it tests, and for the same
// reason: the marketing copy checker allows a vendor name on paths matching
// /compare/ and nowhere else, and a test that asserts something about those
// names has to be able to contain them.

import { describe, expect, it } from "vitest";

import { COMPARE_ENTRIES, COMPARE_SLUGS, FACTS, compareEntry } from "./data";
import { CONNECT_NODES } from "@/components/marketing/connect/connect-graph";
import { starterSeatCap, tier } from "@/components/marketing/data/pricing";

const NODE_IDS = CONNECT_NODES.map((n) => n.id);

describe("the entries", () => {
  it("have unique names", () => {
    const names = COMPARE_ENTRIES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("have unique slugs where they have one", () => {
    expect(new Set(COMPARE_SLUGS).size).toBe(COMPARE_SLUGS.length);
  });

  it("exposes exactly the entries that have a page", () => {
    expect(COMPARE_SLUGS.sort()).toEqual(
      COMPARE_ENTRIES.filter((e) => e.slug).map((e) => e.slug as string).sort(),
    );
  });

  it("resolves a slug to its entry, and nothing else", () => {
    for (const slug of COMPARE_SLUGS) expect(compareEntry(slug)?.slug).toBe(slug);
    expect(compareEntry("your-stack")).toBeUndefined();
    expect(compareEntry("nope")).toBeUndefined();
  });

  it("answers three questions for every entry: what it is for, what we do, when they win", () => {
    for (const entry of COMPARE_ENTRIES) {
      expect(entry.boughtFor.length).toBeGreaterThan(20);
      expect(entry.ours.length).toBeGreaterThan(60);
      // The honest counter-claim is not optional. It is the reason this page
      // is worth reading at all, and the reason the names are allowed on it.
      expect(entry.theirs.length).toBeGreaterThan(60);
    }
  });

  it("names records that are actually on the connection map", () => {
    for (const entry of COMPARE_ENTRIES) {
      expect(entry.disconnected.length).toBeGreaterThan(0);
      for (const id of entry.disconnected) {
        expect(NODE_IDS, `${entry.name} names a record the map does not have`).toContain(id);
      }
      expect(new Set(entry.disconnected).size).toBe(entry.disconnected.length);
      expect(entry.disconnectedLede.length).toBeGreaterThan(60);
    }
  });

  it("writes no em dash and no double hyphen anywhere", () => {
    for (const entry of COMPARE_ENTRIES) {
      const text = [entry.name, entry.boughtFor, entry.ours, entry.theirs, entry.disconnectedLede].join(" ");
      expect(text).not.toMatch(/[—–―]/);
      expect(text).not.toMatch(/--(?![A-Za-z])|[A-Za-z]--[A-Za-z]/);
    }
  });
});

describe("the rows about us", () => {
  it("quote the seat cap the pricing source enforces, never a typed one", () => {
    const free = FACTS.find(([label]) => label === "Free tier")![1];
    expect(free).toContain(String(starterSeatCap));
  });

  it("quote the tier name and the quote threshold from the same source", () => {
    const growth = tier("growth");
    const listed = FACTS.find(([label]) => label === "Listed price")![1];
    expect(listed).toContain(growth.name);
    expect(listed).toContain(String(growth.seatCap));
  });

  it("still say we hold no certification and ship no connector", () => {
    // These two rows are the ones a procurement team reads as a commitment,
    // and they are the ones a later edit is most likely to soften.
    expect(FACTS.find(([label]) => label === "Certifications")![1]).toMatch(/None/);
    expect(FACTS.find(([label]) => label === "Third party connectors")![1]).toMatch(/None/);
  });

  it("has a unique label per row", () => {
    const labels = FACTS.map(([label]) => label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
