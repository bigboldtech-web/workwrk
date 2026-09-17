import { describe, expect, it } from "vitest";
import {
  RENAMES,
  RENAMES_14PX_ROOT,
  RENAMES_16PX_ROOT,
  SCALE_PX,
  capWeights,
  enclosingLiteral,
  mapArbitrarySizes,
  mapPxSize,
  renameStandardSizes,
  transformSource,
} from "./type-scale-codemod.mjs";

// design-system.md 8.2, row by row, plus the sizes the table does not name.
// "ctx" is what the codemod can see: whether the same class string says
// `uppercase`, and whether the file is the rail.
const TABLE: Array<[number, string | null, { uppercase?: boolean; rail?: boolean }?]> = [
  // below the floor: refused (only the marketing mosaic uses them today)
  [7.5, null],
  [8, null],
  [9, null],
  // 10 -> text-rail on the rail, text-micro elsewhere
  [10, "text-micro"],
  [10, "text-rail", { rail: true }],
  // 11 / 11.5 -> text-micro when uppercase, else text-xs
  [11, "text-xs"],
  [11, "text-micro", { uppercase: true }],
  [11.5, "text-xs"],
  [11.5, "text-micro", { uppercase: true }],
  // 12 / 12.5 -> text-xs
  [12, "text-xs"],
  [12.5, "text-xs"],
  // 13 -> text-sm
  [13, "text-sm"],
  // 13.5 / 14 / 14.5 -> text-base
  [13.5, "text-base"],
  [14, "text-base"],
  [14.5, "text-base"],
  // 15 -> text-base (the .os-row container promotes rows)
  [15, "text-base"],
  // half pixels go to zero: 15.5 rounds up to the next step
  [15.5, "text-lg"],
  // 16 / 17 -> text-lg; 18 is nearer 16 than 22
  [16, "text-lg"],
  [17, "text-lg"],
  [18, "text-lg"],
  // 19 is equidistant, ties round up; 20 / 26 -> text-xl per the table
  [19, "text-xl"],
  [20, "text-xl"],
  [21, "text-xl"],
  [22, "text-xl"],
  [24, "text-xl"],
  [26, "text-xl"],
  // above the scale: refused and listed, never guessed
  [28, null],
  [32, null],
  [40, null],
  [42, null],
  [52, null],
];

describe("mapPxSize (8.2 table)", () => {
  it.each(TABLE)("text-[%spx] -> %s", (px, expected, ctx) => {
    expect(mapPxSize(px, ctx ?? {})).toBe(expected);
  });

  it("every mapped target is one of the named sizes", () => {
    for (const [px, expected, ctx] of TABLE) {
      const got = mapPxSize(px, ctx ?? {});
      if (got !== null) expect(Object.keys(SCALE_PX)).toContain(got);
      expect(got).toBe(expected);
    }
  });

  it("never maps to text-row (rows are promoted by the container, 2.3)", () => {
    for (let px = 7; px <= 30; px += 0.5) {
      expect(mapPxSize(px, {})).not.toBe("text-row");
      expect(mapPxSize(px, { uppercase: true, rail: true })).not.toBe("text-row");
    }
  });

  it("refuses garbage", () => {
    expect(mapPxSize("abc" as unknown as number)).toBeNull();
    expect(mapPxSize(Number.NaN)).toBeNull();
  });
});

describe("renameStandardSizes (phase R)", () => {
  it("16px root: moves every pre-flip name to the name of the same nominal size", () => {
    expect(RENAMES).toBe(RENAMES_16PX_ROOT);
    expect(RENAMES_16PX_ROOT).toEqual({
      "text-xs": "text-sm",
      "text-sm": "text-base",
      "text-base": "text-lg",
      "text-lg": "text-lg",
      "text-xl": "text-xl",
    });
  });

  it("14px root (os.css loaded): moves every name to the one of the same rendered size", () => {
    // rendered today: xs 11.375, sm 12.25, base 14, lg 15.75, xl 17.5
    expect(RENAMES_14PX_ROOT).toEqual({
      "text-xs": "text-xs",
      "text-sm": "text-xs",
      "text-base": "text-base",
      "text-lg": "text-lg",
      "text-xl": "text-lg",
    });
    const { out, counts } = renameStandardSizes('"text-xs text-sm text-base text-lg text-xl"', RENAMES_14PX_ROOT);
    expect(out).toBe('"text-xs text-xs text-base text-lg text-lg"');
    expect(counts).toEqual({ "text-sm -> text-xs": 1, "text-xl -> text-lg": 1 });
  });

  it("each table sends a name to the scale step nearest its pre-flip RENDERED size", () => {
    // The pre-flip rem bindings (the token step's text-xs 0.8125, then
    // Tailwind's sm 0.875, base 1, lg 1.125, xl 1.25) at the two root sizes
    // the app has: 16px (marketing, auth, admin, public, setup, onboard) and
    // 14px (tokens.css `:root, .workwrk-os`, the (dashboard) tree).
    const REM = { "text-xs": 0.8125, "text-sm": 0.875, "text-base": 1, "text-lg": 1.125, "text-xl": 1.25 };
    const nearest = (px: number) =>
      (Object.entries(SCALE_PX) as Array<[string, number]>)
        .filter(([name]) => name in REM)
        .sort((a, b) => Math.abs(a[1] - px) - Math.abs(b[1] - px) || b[1] - a[1])[0][0];
    for (const [name, rem] of Object.entries(REM)) {
      expect(RENAMES_16PX_ROOT[name as keyof typeof RENAMES_16PX_ROOT]).toBe(nearest(rem * 16));
      expect(RENAMES_14PX_ROOT[name as keyof typeof RENAMES_14PX_ROOT]).toBe(nearest(rem * 14));
    }
    // The marketing topbar's nav links were text-sm at the 16px root (14px
    // rendered) and must still render 14 after the flip: text-base, not
    // text-xs (12), which is what the 14px table would have made them.
    const nav = renameStandardSizes('className="text-sm text-slate-600 px-3"', RENAMES_16PX_ROOT).out;
    expect(nav).toBe('className="text-base text-slate-600 px-3"');
  });

  it("does not chain: xs -> sm, never xs -> sm -> base in one pass", () => {
    const { out, counts } = renameStandardSizes('className="text-xs text-sm text-base text-lg text-xl"');
    expect(out).toBe('className="text-sm text-base text-lg text-lg text-xl"');
    expect(counts).toEqual({
      "text-xs -> text-sm": 1,
      "text-sm -> text-base": 1,
      "text-base -> text-lg": 1,
    });
  });

  it("keeps variants and the important marker", () => {
    const { out } = renameStandardSizes("`lg:text-xs sm:text-base !text-sm hover:text-xs`");
    expect(out).toBe("`lg:text-sm sm:text-lg !text-base hover:text-sm`");
  });

  it("leaves look-alikes alone", () => {
    const src = 'const a = "text-xsomething subtext-xs text-baseline text-xs-extra"; import x from "@/text-sm/y";';
    expect(renameStandardSizes(src).out).toBe(src);
  });

  it("does not touch the four new names or larger Tailwind sizes", () => {
    const src = '"text-row text-micro text-rail text-prose text-2xl text-3xl"';
    expect(renameStandardSizes(src).out).toBe(src);
  });
});

describe("mapArbitrarySizes (phase P)", () => {
  it("maps inside a className and counts per target", () => {
    const { out, counts, refused } = mapArbitrarySizes(
      'className="text-[13px] font-medium md:text-[14px] text-[12.5px]"',
    );
    expect(out).toBe('className="text-sm font-medium md:text-base text-xs"');
    expect(counts).toEqual({ "text-sm": 1, "text-base": 1, "text-xs": 1 });
    expect(refused).toEqual([]);
  });

  it("reads `uppercase` from the same class string for 11px", () => {
    const a = mapArbitrarySizes('className="text-[11px] uppercase tracking-wide"');
    expect(a.out).toBe('className="text-micro uppercase tracking-wide"');
    const b = mapArbitrarySizes('className="text-[11px] text-ink-2"');
    expect(b.out).toBe('className="text-xs text-ink-2"');
    // a sibling string on the same line does not leak its `uppercase`
    const c = mapArbitrarySizes('cn("text-[11px]", cond && "uppercase")');
    expect(c.out).toBe('cn("text-xs", cond && "uppercase")');
  });

  it("sends 10px to text-rail only in the rail file", () => {
    expect(mapArbitrarySizes('"text-[10px]"', { rail: true }).out).toBe('"text-rail"');
    expect(mapArbitrarySizes('"text-[10px]"').out).toBe('"text-micro"');
  });

  it("refuses sizes above the scale and reports the line", () => {
    const src = 'a\nb className="text-[42px] font-semibold"\nc "text-[8px]"';
    const { out, refused } = mapArbitrarySizes(src);
    expect(out).toBe(src);
    expect(refused).toEqual([
      { line: 2, token: "text-[42px]" },
      { line: 3, token: "text-[8px]" },
    ]);
  });

  it("is idempotent", () => {
    const once = mapArbitrarySizes('"text-[13.5px] text-[15px] text-[20px]"').out;
    const twice = mapArbitrarySizes(once);
    expect(twice.out).toBe(once);
    expect(twice.counts).toEqual({});
  });
});

describe("capWeights (phase W)", () => {
  it("maps the class utilities to font-semibold", () => {
    const { out, counts } = capWeights('"font-bold md:font-extrabold font-black font-semibold"');
    expect(out).toBe('"font-semibold md:font-semibold font-semibold font-semibold"');
    expect(counts).toEqual({
      "font-bold -> font-semibold": 1,
      "font-extrabold -> font-semibold": 1,
      "font-black -> font-semibold": 1,
    });
  });

  it("caps inline style weights at 600 and leaves 500 and 600", () => {
    const src = 'style={{ fontWeight: 700, fontSize: 13 }} s2={{ fontWeight: "800" }} s3={{ fontWeight: 600 }} s4={{ fontWeight: 500,\n}}';
    const { out } = capWeights(src);
    expect(out).toBe('style={{ fontWeight: 600, fontSize: 13 }} s2={{ fontWeight: 600 }} s3={{ fontWeight: 600 }} s4={{ fontWeight: 500,\n}}');
  });

  it("is idempotent", () => {
    const once = capWeights('"font-bold" style={{ fontWeight: 700 }}').out;
    expect(capWeights(once).out).toBe(once);
    expect(capWeights(once).counts).toEqual({});
  });
});

describe("transformSource (the whole file transform)", () => {
  const src = [
    'const a = "text-xs font-bold text-[13px]";',
    'const b = `text-[11px] uppercase ${x} text-lg`;',
    'const c = <span style={{ fontWeight: 700 }} className="text-[10px] text-[40px]" />;',
  ].join("\n");

  it("runs R before P so P's output is never renamed", () => {
    const { out, counts, refused, changed } = transformSource(src, { rename: true, product: true });
    expect(changed).toBe(true);
    expect(out).toBe(
      [
        'const a = "text-sm font-semibold text-sm";',
        'const b = `text-micro uppercase ${x} text-lg`;',
        'const c = <span style={{ fontWeight: 600 }} className="text-micro text-[40px]" />;',
      ].join("\n"),
    );
    expect(counts["rename text-xs -> text-sm"]).toBe(1);
    expect(counts["px -> text-sm"]).toBe(1);
    expect(counts["px -> text-micro"]).toBe(2);
    expect(counts["weight font-bold -> font-semibold"]).toBe(1);
    expect(counts["weight fontWeight 700 -> 600"]).toBe(1);
    expect(refused).toEqual([{ line: 3, token: "text-[40px]" }]);
  });

  it("under the 14px root the rename keeps rendered sizes", () => {
    const { out } = transformSource(src, { rename: true, root14: true, product: true });
    expect(out).toBe(
      [
        'const a = "text-xs font-semibold text-sm";',
        'const b = `text-micro uppercase ${x} text-lg`;',
        'const c = <span style={{ fontWeight: 600 }} className="text-micro text-[40px]" />;',
      ].join("\n"),
    );
  });

  it("a second run with rename off changes nothing", () => {
    for (const root14 of [false, true]) {
      const once = transformSource(src, { rename: true, root14, product: true }).out;
      const twice = transformSource(once, { rename: false, root14, product: true });
      expect(twice.changed).toBe(false);
      expect(twice.out).toBe(once);
    }
  });

  it("marketing files only get the rename", () => {
    const { out } = transformSource(src, { rename: true, product: false });
    expect(out).toBe(
      [
        'const a = "text-sm font-bold text-[13px]";',
        'const b = `text-[11px] uppercase ${x} text-lg`;',
        'const c = <span style={{ fontWeight: 700 }} className="text-[10px] text-[40px]" />;',
      ].join("\n"),
    );
  });
});

describe("enclosingLiteral", () => {
  it("stops at the nearest quote on each side", () => {
    const src = 'cn("a b", `c ${d} e`, "f")';
    const i = src.indexOf("c ");
    expect(enclosingLiteral(src, i)).toBe("c ${d} e");
  });
});
