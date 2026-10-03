// The streaming ZIP writer, read back the way an unzip tool reads it: the end
// record (ZIP64 when marked), the central directory, each local header, the
// deflated bytes inflated, the CRC checked, and the data descriptor after
// the data.

import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, zipFiles, zipTextFile } from "./zip";
import { dosDateTime, zipDirectory, zipStream, type ZipStreamEntry } from "./zip-stream";

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

type Read = { name: string; data: Uint8Array; flags: number; method: number; time: number; date: number };

function endRecords(buf: Uint8Array): { count: number; cdSize: number; cdStart: number; zip64: boolean } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  let count = view.getUint16(eocd + 10, true);
  let cdSize = view.getUint32(eocd + 12, true);
  let cdStart = view.getUint32(eocd + 16, true);
  let zip64 = false;
  if (count === 0xffff || cdSize === 0xffffffff || cdStart === 0xffffffff) {
    zip64 = true;
    const locator = eocd - 20;
    expect(view.getUint32(locator, true)).toBe(0x07064b50);
    const rec = Number(view.getBigUint64(locator + 8, true));
    expect(view.getUint32(rec, true)).toBe(0x06064b50);
    count = Number(view.getBigUint64(rec + 32, true));
    cdSize = Number(view.getBigUint64(rec + 40, true));
    cdStart = Number(view.getBigUint64(rec + 48, true));
  }
  return { count, cdSize, cdStart, zip64 };
}

function readZip(buf: Uint8Array): { entries: Read[]; zip64: boolean } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const { count, cdSize, cdStart, zip64 } = endRecords(buf);
  const entries: Read[] = [];
  let at = cdStart;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const csize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    let local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen));
    if (local === 0xffffffff) local = Number(view.getBigUint64(at + 46 + nameLen + 4, true));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 6, true)).toBe(flags);
    const lName = view.getUint16(local + 26, true);
    const lExtra = view.getUint16(local + 28, true);
    const dataAt = local + 30 + lName + lExtra;
    const stored = buf.subarray(dataAt, dataAt + csize);
    const data = method === 8 ? new Uint8Array(inflateRawSync(stored)) : stored;
    expect(data.length).toBe(size);
    expect(crc32(data)).toBe(crc);
    if (flags & 0x0008) {
      // The data descriptor right after the data, with its signature.
      const d = dataAt + csize;
      expect(view.getUint32(d, true)).toBe(0x08074b50);
      expect(view.getUint32(d + 4, true)).toBe(crc);
      expect(view.getUint32(d + 8, true)).toBe(csize);
      expect(view.getUint32(d + 12, true)).toBe(size);
    }
    entries.push({ name, data, flags, method, time, date });
    at += 46 + nameLen + extraLen;
  }
  expect(at).toBe(cdStart + cdSize);
  return { entries, zip64 };
}

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe("zipStream", () => {
  it("writes every entry readable by name, bytes and CRC, compressed, names in UTF-8", async () => {
    async function* files(): AsyncGenerator<ZipStreamEntry> {
      yield { name: "manifest.json", data: '{"ok":true}' };
      yield { name: "docs/Café plan.md", data: text("# Café plan\n\nBody") };
      yield { name: "empty.csv", data: "" };
    }
    const { entries, zip64 } = readZip(await collect(zipStream(files())));
    expect(zip64).toBe(false);
    expect(entries.map((e) => e.name)).toEqual(["manifest.json", "docs/Café plan.md", "empty.csv"]);
    expect(decode(entries[0].data)).toBe('{"ok":true}');
    expect(decode(entries[1].data)).toBe("# Café plan\n\nBody");
    expect(entries[2].data.length).toBe(0);
    for (const e of entries) {
      expect(e.method).toBe(8);
      expect(e.flags & 0x0800).toBe(0x0800);
      expect(e.flags & 0x0008).toBe(0x0008);
    }
  });

  it("joins an entry's pieces into one file, small and large pieces alike", async () => {
    const big = "row,".repeat(40_000) + "\n"; // over the in-line size: the thread pool path
    async function* rows(): AsyncGenerator<string | Uint8Array> {
      yield "id,title\n";
      for (let i = 0; i < 50; i++) yield `${i},Task ${i}\n`;
      yield big;
      yield "";
      yield text("last,row\n");
    }
    const { entries } = readZip(await collect(zipStream([{ name: "list-tasks.csv", data: rows() }])));
    let want = "id,title\n";
    for (let i = 0; i < 50; i++) want += `${i},Task ${i}\n`;
    want += big + "last,row\n";
    expect(decode(entries[0].data)).toBe(want);
  });

  it("compresses text well below its size", async () => {
    const csv = "id,title,status\n" + Array.from({ length: 2000 }, (_, i) => `${i},Write the weekly report,In progress`).join("\n");
    const zipped = await collect(zipStream([{ name: "a.csv", data: csv }]));
    expect(zipped.length).toBeLessThan(csv.length / 4);
  });

  it("stamps every entry with the export time, in UTC", async () => {
    const at = new Date(Date.UTC(2026, 9, 4, 13, 45, 31));
    const { entries } = readZip(await collect(zipStream([{ name: "a.txt", data: "a" }], { modified: at })));
    expect(entries[0].date).toBe(((2026 - 1980) << 9) | (10 << 5) | 4);
    expect(entries[0].time).toBe((13 << 11) | (45 << 5) | 15);
    expect(dosDateTime(new Date(Date.UTC(1970, 0, 1))).date >> 9).toBe(0);
  });

  it("asks for each entry only when the reader is ready for it", async () => {
    let made = 0;
    function* files(): Generator<ZipStreamEntry> {
      for (let i = 0; i < 3; i++) {
        made += 1;
        yield { name: `f${i}.txt`, data: `file ${i}` };
      }
    }
    const reader = zipStream(files()).getReader();
    await reader.read();
    expect(made).toBe(1);
    await reader.cancel();
  });

  it("lets the entries clean up when the reader walks away", async () => {
    let cleaned = false;
    async function* files(): AsyncGenerator<ZipStreamEntry> {
      try {
        for (let i = 0; i < 100; i++) yield { name: `f${i}.txt`, data: `file ${i}` };
      } finally {
        cleaned = true;
      }
    }
    const reader = zipStream(files()).getReader();
    await reader.read();
    await reader.read();
    await reader.cancel();
    expect(cleaned).toBe(true);
  });

  it("goes ZIP64 past 65,535 entries and every tool still finds them all", async () => {
    const n = 65_600;
    function* files(): Generator<ZipStreamEntry> {
      for (let i = 0; i < n; i++) yield { name: `t/${i}.txt`, data: String(i) };
    }
    const { entries, zip64 } = readZip(await collect(zipStream(files())));
    expect(zip64).toBe(true);
    expect(entries.length).toBe(n);
    expect(entries[n - 1].name).toBe(`t/${n - 1}.txt`);
    expect(decode(entries[n - 1].data)).toBe(String(n - 1));
  }, 30_000);

  it("fails the stream, never a half archive that looks whole, when making an entry fails", async () => {
    async function* files(): AsyncGenerator<ZipStreamEntry> {
      yield { name: "a.txt", data: "a" };
      throw new Error("read failed");
    }
    await expect(collect(zipStream(files()))).rejects.toThrow("read failed");
  });

  it("fails the stream when a piece of an entry fails", async () => {
    async function* rows(): AsyncGenerator<string> {
      yield "id\n";
      throw new Error("page failed");
    }
    await expect(collect(zipStream([{ name: "a.csv", data: rows() }]))).rejects.toThrow("page failed");
  });
});

describe("zipStream onDone", () => {
  it("says completed only after the whole archive, directory included, and before the stream ends", async () => {
    const events: string[] = [];
    const stream = zipStream([{ name: "a.txt", data: "a" }], {
      onDone: async (o) => {
        events.push(`done:${o}`);
      },
    });
    const reader = stream.getReader();
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        events.push("end");
        break;
      }
      bytes += value.length;
    }
    expect(events).toEqual(["done:completed", "end"]);
    expect(bytes).toBeGreaterThan(22);
  });

  it("says stopped when an entry fails or the reader walks away, once", async () => {
    const seen: string[] = [];
    async function* bad(): AsyncGenerator<ZipStreamEntry> {
      yield { name: "a.txt", data: "a" };
      throw new Error("read failed");
    }
    await expect(collect(zipStream(bad(), { onDone: (o) => void seen.push(o) }))).rejects.toThrow("read failed");
    const reader = zipStream([{ name: "a.txt", data: "a" }, { name: "b.txt", data: "b" }], { onDone: (o) => void seen.push(o) }).getReader();
    await reader.read();
    await reader.cancel();
    expect(seen).toEqual(["stopped", "stopped"]);
  });
});

describe("zipDirectory past 4 GB", () => {
  it("moves a far offset into a ZIP64 extra field and writes the ZIP64 end records", () => {
    const name = text("far.csv");
    const stamp = dosDateTime(new Date(Date.UTC(2026, 0, 1)));
    const near = { nameBytes: text("near.csv"), crc: 1, size: 10, csize: 8, offset: 0 };
    const far = { nameBytes: name, crc: 2, size: 20, csize: 12, offset: 5_000_000_000 };
    const cdStart = 6_000_000_000;
    const out = zipDirectory([near, far], cdStart, stamp);
    const view = new DataView(out.buffer);
    // The near entry: a plain 32-bit offset, no extra.
    expect(view.getUint32(42, true)).toBe(0);
    expect(view.getUint16(30, true)).toBe(0);
    // The far entry: the marker in the offset field, the real one in the extra.
    const second = 46 + near.nameBytes.length;
    expect(view.getUint16(second + 6, true)).toBe(45);
    expect(view.getUint16(second + 30, true)).toBe(12);
    expect(view.getUint32(second + 42, true)).toBe(0xffffffff);
    expect(view.getUint16(second + 46 + name.length, true)).toBe(0x0001);
    expect(Number(view.getBigUint64(second + 46 + name.length + 4, true))).toBe(5_000_000_000);
    const cdSize = second + 46 + name.length + 12;
    // The ZIP64 record and its locator, then the end record with the marker.
    expect(view.getUint32(cdSize, true)).toBe(0x06064b50);
    expect(Number(view.getBigUint64(cdSize + 24, true))).toBe(2);
    expect(Number(view.getBigUint64(cdSize + 40, true))).toBe(cdSize);
    expect(Number(view.getBigUint64(cdSize + 48, true))).toBe(cdStart);
    expect(view.getUint32(cdSize + 56, true)).toBe(0x07064b50);
    expect(Number(view.getBigUint64(cdSize + 64, true))).toBe(cdStart + cdSize);
    const eocd = out.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(2);
    expect(view.getUint32(eocd + 16, true)).toBe(0xffffffff);
  });
});

describe("zipFiles (whole archive in memory)", () => {
  it("still reads back exactly", () => {
    const { entries } = readZip(zipFiles([zipTextFile("a.csv", "x,y\n1,2"), zipTextFile("b.json", "{}")]));
    expect(entries.map((e) => [e.name, decode(e.data)])).toEqual([
      ["a.csv", "x,y\n1,2"],
      ["b.json", "{}"],
    ]);
  });

  it("sums a CRC piece by piece to the same value as whole", () => {
    const a = text("hello, ");
    const b = text("world");
    expect(crc32(b, crc32(a))).toBe(crc32(text("hello, world")));
  });
});
