import { describe, expect, it } from "vitest";
import { autoTypeEntry, autoTypeEntryRich, autoTypeForColumn, isOpenColumnType } from "./sheet-entry";

describe("autoTypeEntry: plain numbers", () => {
  it("integers and decimals become numbers", () => {
    expect(autoTypeEntry("5")).toBe(5);
    expect(autoTypeEntry("5.5")).toBe(5.5);
    expect(autoTypeEntry("-5")).toBe(-5);
    expect(autoTypeEntry("-5.25")).toBe(-5.25);
    expect(autoTypeEntry("42")).toBe(42);
  });

  it("zero and fractions of zero are numbers (the zero is the value)", () => {
    expect(autoTypeEntry("0")).toBe(0);
    expect(autoTypeEntry("0.5")).toBe(0.5);
    expect(autoTypeEntry("0.0")).toBe(0);
    expect(autoTypeEntry("-0.5")).toBe(-0.5);
  });

  it("bare decimal point forms follow Sheets: .5 is 0.5, 5. is 5", () => {
    expect(autoTypeEntry(".5")).toBe(0.5);
    expect(autoTypeEntry("-.5")).toBe(-0.5);
    expect(autoTypeEntry("5.")).toBe(5);
  });

  it("-0 collapses to 0 so storage and the conflict guard never see a negative zero", () => {
    const v = autoTypeEntry("-0");
    expect(v).toBe(0);
    expect(Object.is(v, 0)).toBe(true);
    expect(Object.is(autoTypeEntry("-0.0"), 0)).toBe(true);
  });

  it("surrounding whitespace is ignored", () => {
    expect(autoTypeEntry("  42  ")).toBe(42);
    expect(autoTypeEntry("\t7\n")).toBe(7);
    expect(autoTypeEntry(" -1.5 ")).toBe(-1.5);
  });
});

describe("autoTypeEntry: thousands grouping", () => {
  it("strict 3-groups parse", () => {
    expect(autoTypeEntry("1,000")).toBe(1000);
    expect(autoTypeEntry("12,345.67")).toBe(12345.67);
    expect(autoTypeEntry("1,234,567")).toBe(1234567);
    expect(autoTypeEntry("-1,000.5")).toBe(-1000.5);
  });

  it("bad grouping stays text", () => {
    expect(autoTypeEntry("1,00")).toBe("1,00");
    expect(autoTypeEntry("1,0000")).toBe("1,0000");
    expect(autoTypeEntry("1,000,00")).toBe("1,000,00");
    expect(autoTypeEntry(",000")).toBe(",000");
    expect(autoTypeEntry("1,")).toBe("1,");
    expect(autoTypeEntry("1,000.")).toBe(1000); // grouping fine, trailing point allowed
  });

  it("a leading-zero first group is padding, not a number", () => {
    expect(autoTypeEntry("0,123")).toBe("0,123");
  });
});

describe("autoTypeEntry: what stays text", () => {
  it("leading zeros are IDs and zip codes", () => {
    expect(autoTypeEntry("007")).toBe("007");
    expect(autoTypeEntry("0123")).toBe("0123");
    expect(autoTypeEntry("00")).toBe("00");
    expect(autoTypeEntry("00.5")).toBe("00.5");
    expect(autoTypeEntry("-007")).toBe("-007");
  });

  it("a leading plus stays text", () => {
    expect(autoTypeEntry("+5")).toBe("+5");
    expect(autoTypeEntry("+1 555 0100")).toBe("+1 555 0100");
  });

  it("percent, currency and unit suffixes stay text here (paste/fill/import carry no cell format; the editor uses autoTypeEntryRich)", () => {
    expect(autoTypeEntry("5%")).toBe("5%");
    expect(autoTypeEntry("$5")).toBe("$5");
    expect(autoTypeEntry("5 USD")).toBe("5 USD");
    expect(autoTypeEntry("€5")).toBe("€5");
  });

  it("exponent notation stays text", () => {
    expect(autoTypeEntry("1e3")).toBe("1e3");
    expect(autoTypeEntry("1E3")).toBe("1E3");
    expect(autoTypeEntry("2.5e-3")).toBe("2.5e-3");
  });

  it("words, mixed text and the JS number words stay text", () => {
    expect(autoTypeEntry("abc")).toBe("abc");
    expect(autoTypeEntry("12abc")).toBe("12abc");
    expect(autoTypeEntry("abc12")).toBe("abc12");
    expect(autoTypeEntry("NaN")).toBe("NaN");
    expect(autoTypeEntry("Infinity")).toBe("Infinity");
    expect(autoTypeEntry("-Infinity")).toBe("-Infinity");
    expect(autoTypeEntry("0x10")).toBe("0x10");
    expect(autoTypeEntry("1 000")).toBe("1 000");
    expect(autoTypeEntry("1_000")).toBe("1_000");
  });

  it("punctuation-only entries stay text", () => {
    expect(autoTypeEntry("-")).toBe("-");
    expect(autoTypeEntry(".")).toBe(".");
    expect(autoTypeEntry("-.")).toBe("-.");
    expect(autoTypeEntry("--5")).toBe("--5");
    expect(autoTypeEntry("5-")).toBe("5-");
    expect(autoTypeEntry("1.2.3")).toBe("1.2.3");
  });

  it("non-ASCII digits and minus signs stay text", () => {
    expect(autoTypeEntry("１２３")).toBe("１２３");
    expect(autoTypeEntry("−5")).toBe("−5");
  });

  it("formulas and dates stay text (other code paths own them)", () => {
    expect(autoTypeEntry("=A1+1")).toBe("=A1+1");
    expect(autoTypeEntry("2024-01-05")).toBe("2024-01-05");
    expect(autoTypeEntry("1/2")).toBe("1/2");
  });
});

describe("autoTypeEntry: precision ceiling", () => {
  it("15 significant digits is a number, 16 is text", () => {
    expect(autoTypeEntry("999999999999999")).toBe(999999999999999);
    expect(autoTypeEntry("1234567890123456")).toBe("1234567890123456");
    expect(autoTypeEntry("123456789012345")).toBe(123456789012345);
  });

  it("digits are counted across the decimal point", () => {
    expect(autoTypeEntry("12345678.9012345")).toBe(12345678.9012345);
    expect(autoTypeEntry("12345678.90123456")).toBe("12345678.90123456");
  });

  it("grouped digits count the same as plain digits", () => {
    expect(autoTypeEntry("999,999,999,999,999")).toBe(999999999999999);
    expect(autoTypeEntry("1,234,567,890,123,456")).toBe("1,234,567,890,123,456");
  });

  it("trailing fraction zeros and leading zeros carry no precision", () => {
    expect(autoTypeEntry("1.50000000000000000")).toBe(1.5);
    expect(autoTypeEntry("0.000000000000000001")).toBe(1e-18);
  });

  it("a round 16-digit integer stays text (display honesty over cleverness)", () => {
    expect(autoTypeEntry("1000000000000000")).toBe("1000000000000000");
  });

  it("phone numbers and card numbers never become numbers", () => {
    expect(autoTypeEntry("4111111111111111")).toBe("4111111111111111");
    expect(autoTypeEntry("919876543210123")).toBe(919876543210123); // 15 digits: still a number, documented ceiling
  });
});

describe("autoTypeEntry: return-type honesty", () => {
  it("empty string is the empty cell", () => {
    expect(autoTypeEntry("")).toBe("");
  });

  it("non-numbers come back as the ORIGINAL string, whitespace intact", () => {
    expect(autoTypeEntry("  abc  ")).toBe("  abc  ");
    expect(autoTypeEntry("   ")).toBe("   ");
    expect(autoTypeEntry(" 5% ")).toBe(" 5% ");
    expect(autoTypeEntry(" 007 ")).toBe(" 007 ");
  });

  it("never returns NaN or an infinite number", () => {
    for (const s of ["NaN", "Infinity", "-Infinity", "1e400", "abc", ""]) {
      const v = autoTypeEntry(s);
      if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("a number round-trips through JSON unchanged (what the API stores)", () => {
    for (const s of ["5", "-5", "0.5", "12,345.67", "999999999999999", "-0"]) {
      const v = autoTypeEntry(s);
      expect(JSON.parse(JSON.stringify(v))).toBe(v);
    }
  });
});

describe("autoTypeEntryRich: percent entry", () => {
  it("divides by 100 and reports nf percent", () => {
    expect(autoTypeEntryRich("5%")).toStrictEqual({ value: 0.05, nf: "percent" });
    expect(autoTypeEntryRich("12.5%")).toStrictEqual({ value: 0.125, nf: "percent" });
    expect(autoTypeEntryRich("-3%")).toStrictEqual({ value: -0.03, nf: "percent" });
    expect(autoTypeEntryRich("100%")).toStrictEqual({ value: 1, nf: "percent" });
    expect(autoTypeEntryRich("0%")).toStrictEqual({ value: 0, nf: "percent" });
    expect(autoTypeEntryRich(".5%")).toStrictEqual({ value: 0.005, nf: "percent" });
    expect(autoTypeEntryRich("1,000%")).toStrictEqual({ value: 10, nf: "percent" });
  });

  it("kills the float noise of the /100 (33.3% is 0.333, not 0.33299999999999996)", () => {
    // The noise is real in a double; the rounding must remove exactly it.
    expect(33.3 / 100).not.toBe(0.333);
    expect(8.2 / 100).not.toBe(0.082);
    expect(1.1 / 100).not.toBe(0.011);
    expect(autoTypeEntryRich("33.3%")).toStrictEqual({ value: 0.333, nf: "percent" });
    expect(autoTypeEntryRich("8.2%")).toStrictEqual({ value: 0.082, nf: "percent" });
    expect(autoTypeEntryRich("1.1%")).toStrictEqual({ value: 0.011, nf: "percent" });
    expect(autoTypeEntryRich("0.7%")).toStrictEqual({ value: 0.007, nf: "percent" });
    expect(autoTypeEntryRich("9.95%")).toStrictEqual({ value: 0.0995, nf: "percent" });
    expect(autoTypeEntryRich("1.005%")).toStrictEqual({ value: 0.01005, nf: "percent" });
    expect(autoTypeEntryRich("7%")).toStrictEqual({ value: 0.07, nf: "percent" });
    // Sweep: every one- or two-decimal percentage up to 1000% renders
    // with at most (input decimals + 2) fraction digits, never a 17-digit tail.
    for (let i = 0; i < 1000; i++) {
      for (const f of ["", ".1", ".3", ".7", ".9", ".15", ".35", ".85"]) {
        const s = `${i}${f}`;
        const r = autoTypeEntryRich(`${s}%`);
        expect(r.nf).toBe("percent");
        const frac = String(r.value).split(".")[1] ?? "";
        expect(frac.length).toBeLessThanOrEqual(f.length ? f.length - 1 + 2 : 2);
      }
    }
  });

  it("accepts a space before the sign, as Sheets does; the surrounding whitespace too", () => {
    expect(autoTypeEntryRich("5 %")).toStrictEqual({ value: 0.05, nf: "percent" });
    expect(autoTypeEntryRich("  5%  ")).toStrictEqual({ value: 0.05, nf: "percent" });
    expect(autoTypeEntryRich(" -2.5 % ")).toStrictEqual({ value: -0.025, nf: "percent" });
  });

  it("a sign in the wrong place, a double sign or a bare sign is text", () => {
    expect(autoTypeEntryRich("%5")).toStrictEqual({ value: "%5" });
    expect(autoTypeEntryRich("5%%")).toStrictEqual({ value: "5%%" });
    expect(autoTypeEntryRich("%")).toStrictEqual({ value: "%" });
    expect(autoTypeEntryRich(" %")).toStrictEqual({ value: " %" });
    expect(autoTypeEntryRich("5%5")).toStrictEqual({ value: "5%5" });
    expect(autoTypeEntryRich("$5%")).toStrictEqual({ value: "$5%" });
  });

  it("the numeric part obeys the full grammar (leading zeros, 15 digits, plus, exponent)", () => {
    expect(autoTypeEntryRich("007%")).toStrictEqual({ value: "007%" });
    expect(autoTypeEntryRich("+5%")).toStrictEqual({ value: "+5%" });
    expect(autoTypeEntryRich("1e3%")).toStrictEqual({ value: "1e3%" });
    expect(autoTypeEntryRich("1,00%")).toStrictEqual({ value: "1,00%" });
    expect(autoTypeEntryRich("1234567890123456%")).toStrictEqual({ value: "1234567890123456%" });
    expect(autoTypeEntryRich("abc%")).toStrictEqual({ value: "abc%" });
  });

  it("-0% collapses to 0 (no negative zero reaches storage)", () => {
    const r = autoTypeEntryRich("-0%");
    expect(Object.is(r.value, 0)).toBe(true);
    expect(r.nf).toBe("percent");
  });
});

describe("autoTypeEntryRich: currency entry", () => {
  it("strips the symbol and reports nf currency", () => {
    expect(autoTypeEntryRich("$5")).toStrictEqual({ value: 5, nf: "currency" });
    expect(autoTypeEntryRich("$1,234.50")).toStrictEqual({ value: 1234.5, nf: "currency" });
    expect(autoTypeEntryRich("$0.99")).toStrictEqual({ value: 0.99, nf: "currency" });
    expect(autoTypeEntryRich("$0")).toStrictEqual({ value: 0, nf: "currency" });
    expect(autoTypeEntryRich("$.5")).toStrictEqual({ value: 0.5, nf: "currency" });
    expect(autoTypeEntryRich("$5.")).toStrictEqual({ value: 5, nf: "currency" });
  });

  it("the minus goes before the symbol only", () => {
    expect(autoTypeEntryRich("-$5")).toStrictEqual({ value: -5, nf: "currency" });
    expect(autoTypeEntryRich("-$1,234.50")).toStrictEqual({ value: -1234.5, nf: "currency" });
    expect(autoTypeEntryRich("$-5")).toStrictEqual({ value: "$-5" });
    expect(autoTypeEntryRich("-$-5")).toStrictEqual({ value: "-$-5" });
    expect(autoTypeEntryRich("--$5")).toStrictEqual({ value: "--$5" });
    expect(autoTypeEntryRich("- $5")).toStrictEqual({ value: "- $5" });
    expect(autoTypeEntryRich("+$5")).toStrictEqual({ value: "+$5" });
  });

  it("a bare symbol, a gap after it, or a trailing symbol is text", () => {
    expect(autoTypeEntryRich("$")).toStrictEqual({ value: "$" });
    expect(autoTypeEntryRich("-$")).toStrictEqual({ value: "-$" });
    expect(autoTypeEntryRich("$ 5")).toStrictEqual({ value: "$ 5" });
    expect(autoTypeEntryRich("5$")).toStrictEqual({ value: "5$" });
    expect(autoTypeEntryRich("$$5")).toStrictEqual({ value: "$$5" });
    expect(autoTypeEntryRich("$5 USD")).toStrictEqual({ value: "$5 USD" });
    expect(autoTypeEntryRich("$abc")).toStrictEqual({ value: "$abc" });
    expect(autoTypeEntryRich("US$5")).toStrictEqual({ value: "US$5" });
    expect(autoTypeEntryRich("€5")).toStrictEqual({ value: "€5" });
  });

  it("surrounding whitespace is ignored", () => {
    expect(autoTypeEntryRich("  $5  ")).toStrictEqual({ value: 5, nf: "currency" });
    expect(autoTypeEntryRich("\t-$5\n")).toStrictEqual({ value: -5, nf: "currency" });
  });

  it("the numeric part obeys the full grammar (leading zeros, 15 digits, exponent, grouping)", () => {
    expect(autoTypeEntryRich("$007")).toStrictEqual({ value: "$007" });
    expect(autoTypeEntryRich("$00.5")).toStrictEqual({ value: "$00.5" });
    expect(autoTypeEntryRich("$1234567890123456")).toStrictEqual({ value: "$1234567890123456" });
    expect(autoTypeEntryRich("$999999999999999")).toStrictEqual({ value: 999999999999999, nf: "currency" });
    expect(autoTypeEntryRich("$1e3")).toStrictEqual({ value: "$1e3" });
    expect(autoTypeEntryRich("$1,00")).toStrictEqual({ value: "$1,00" });
    expect(autoTypeEntryRich("$1.2.3")).toStrictEqual({ value: "$1.2.3" });
  });

  it("-$0 collapses to 0", () => {
    const r = autoTypeEntryRich("-$0");
    expect(Object.is(r.value, 0)).toBe(true);
    expect(r.nf).toBe("currency");
  });
});

describe("autoTypeEntryRich: everything else is autoTypeEntry with NO nf", () => {
  it("plain numbers come back without an nf key at all", () => {
    for (const s of ["5", "-5", "0.5", ".5", "5.", "12,345.67", "  42  ", "0", "-0", "999999999999999"]) {
      const r = autoTypeEntryRich(s);
      expect(r).toStrictEqual({ value: autoTypeEntry(s) });
      expect("nf" in r).toBe(false);
      expect(typeof r.value).toBe("number");
    }
  });

  it("text comes back as the original string, whitespace intact, without nf", () => {
    for (const s of ["abc", "  abc  ", "007", "+5", "1e3", "5 USD", "=A1+1", "2024-01-05", "NaN", "   ", "12abc"]) {
      const r = autoTypeEntryRich(s);
      expect(r).toStrictEqual({ value: s });
      expect("nf" in r).toBe(false);
    }
  });

  it("empty string is the empty cell", () => {
    expect(autoTypeEntryRich("")).toStrictEqual({ value: "" });
  });

  it("never returns NaN, an infinite number or a negative zero", () => {
    for (const s of ["NaN%", "Infinity%", "$Infinity", "$NaN", "1e400%", "$1e400", "-0%", "-$0", "-0.0%"]) {
      const v = autoTypeEntryRich(s).value;
      if (typeof v === "number") {
        expect(Number.isFinite(v)).toBe(true);
        expect(Object.is(v, -0)).toBe(false);
      }
    }
  });

  it("a rich value round-trips through JSON unchanged (what the API stores)", () => {
    for (const s of ["5%", "-3%", "$1,234.50", "-$5", "7%"]) {
      const v = autoTypeEntryRich(s).value;
      expect(JSON.parse(JSON.stringify(v))).toBe(v);
    }
  });

  it("agrees with autoTypeEntry on every input that has no symbol", () => {
    for (const s of ["5", "abc", "", "007", "1,000", "-.5", "1e3", " 5 ", "5-"]) {
      expect(autoTypeEntryRich(s).value).toBe(autoTypeEntry(s));
    }
  });
});

describe("isOpenColumnType", () => {
  it("only short_text is open", () => {
    expect(isOpenColumnType("short_text")).toBe(true);
  });

  it("every other text-shaped or typed column stays closed", () => {
    for (const t of ["long_text", "email", "url", "phone", "number", "currency", "percent", "rating", "date", "checkbox", "select", "multi_select", "formula", "person", "attachment", "", "SHORT_TEXT"]) {
      expect(isOpenColumnType(t)).toBe(false);
    }
  });
});

describe("autoTypeForColumn", () => {
  it("auto-types on open columns only", () => {
    expect(autoTypeForColumn("short_text", "5")).toBe(5);
    expect(autoTypeForColumn("short_text", "abc")).toBe("abc");
  });

  it("passes text through untouched on every other column type", () => {
    expect(autoTypeForColumn("number", "5")).toBe("5");
    expect(autoTypeForColumn("long_text", "5")).toBe("5");
    expect(autoTypeForColumn("email", " 5 ")).toBe(" 5 ");
  });
});
