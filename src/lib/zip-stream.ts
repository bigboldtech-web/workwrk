// A ZIP written as it is read, for archives too big to hold in memory: the
// whole-workspace export (src/app/api/export/all). Server-only, because it
// compresses with node:zlib. Every other export zips in memory with
// src/lib/zip.ts.
//
// HOW. Each entry is DEFLATE-compressed as its pieces arrive (a CSV written a
// page of rows at a time, a Doc whole), with general purpose bit 3 set: the
// CRC and sizes follow the data in a data descriptor, so no entry is ever
// held whole. Every piece is compressed on its own and ended with a sync
// flush. Deflate blocks chain, so the pieces read as one stream, which an
// empty final block closes (the way pigz joins its parallel parts). Only the
// central directory, a few dozen bytes an entry, stays in memory to the end.
//
// SIZE. Past 65,535 entries, or a directory past 4 GB into the archive, it
// ends with the ZIP64 records (APPNOTE 4.3.14 and 4.3.15), and an entry whose
// header starts past 4 GB carries its offset in a ZIP64 extra field. One
// entry must stay under 4 GB, compressed and not: the stream fails rather
// than write a size that wraps.
//
// FAILURE. A piece or an entry that throws errors the stream, so the reader
// sees a failed download, never an archive that looks whole.
//
// Reference: APPNOTE.TXT 6.3.10.

import { constants, deflateRaw, deflateRawSync } from "node:zlib";
import { crc32, utf8Encode } from "@/lib/zip";

export type ZipPiece = Uint8Array | string;

export interface ZipStreamEntry {
  name: string;
  /** The entry's bytes whole, or its pieces as they are made. Text is written as UTF-8. */
  data: ZipPiece | Iterable<ZipPiece> | AsyncIterable<ZipPiece>;
}

export interface ZipStreamOptions {
  /** The time every entry is stamped with (UTC). Defaults to now. */
  modified?: Date;
  /** Deflate level, 1 (fastest) to 9 (smallest). Defaults to 6. */
  level?: number;
  /**
   * Called once when the archive ends: "completed" after the central
   * directory is handed on and before the stream closes (awaited, so the
   * reader sees the end only after this has run), "stopped" when an entry
   * failed or the reader went away.
   */
  onDone?: (outcome: "completed" | "stopped") => void | Promise<void>;
}

const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
/** Bit 3: sizes in a data descriptor. Bit 11: the name is UTF-8. */
const FLAGS = 0x0808;
const METHOD_DEFLATE = 8;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
/** An empty final deflate block (fixed Huffman codes): the end of every entry's stream. */
const DEFLATE_END = Uint8Array.of(0x03, 0x00);
/** Pieces up to this size are compressed in line; a larger one on the thread pool. */
const INLINE_MAX = 64 * 1024;

/** One entry as the central directory records it. */
export interface ZipDirEntry {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  csize: number;
  offset: number;
}

/** The archive as a byte stream, each entry asked for only when the reader is ready for it. */
export function zipStream(
  entries: AsyncIterable<ZipStreamEntry> | Iterable<ZipStreamEntry>,
  opts: ZipStreamOptions = {},
): ReadableStream<Uint8Array> {
  const level = opts.level ?? 6;
  const stamp = dosDateTime(opts.modified ?? new Date());
  const bytes = archive(entries, level, stamp);
  let ended = false;
  const done = async (outcome: "completed" | "stopped") => {
    if (ended) return;
    ended = true;
    try {
      await opts.onDone?.(outcome);
    } catch {
      // The archive's outcome is the caller's to record; a failure there
      // never changes what the reader receives.
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await bytes.next();
        if (next.done) {
          await done("completed");
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (err) {
        void done("stopped");
        controller.error(err);
      }
    },
    async cancel() {
      await bytes.return(undefined);
      await done("stopped");
    },
  });
}

async function* archive(
  entries: AsyncIterable<ZipStreamEntry> | Iterable<ZipStreamEntry>,
  level: number,
  stamp: { time: number; date: number },
): AsyncGenerator<Uint8Array> {
  const directory: ZipDirEntry[] = [];
  let offset = 0;
  for await (const entry of entries) {
    const nameBytes = utf8Encode(entry.name);
    if (nameBytes.length > U16_MAX) throw new Error(`zip entry name too long: ${entry.name.slice(0, 80)}`);
    const start = offset;
    const header = localHeader(nameBytes, stamp);
    yield header;
    offset += header.length;
    let crc = 0;
    let size = 0;
    let csize = 0;
    for await (const piece of piecesOf(entry.data)) {
      if (piece.length === 0) continue;
      crc = crc32(piece, crc);
      size += piece.length;
      const out = await deflatePiece(piece, level);
      csize += out.length;
      if (size >= U32_MAX || csize + DEFLATE_END.length >= U32_MAX) throw new Error(`zip entry too large: ${entry.name.slice(0, 80)}`);
      if (out.length > 0) {
        yield out;
        offset += out.length;
      }
    }
    yield DEFLATE_END;
    offset += DEFLATE_END.length;
    csize += DEFLATE_END.length;
    const descriptor = new Uint8Array(16);
    const view = new DataView(descriptor.buffer);
    view.setUint32(0, SIG_DESCRIPTOR, true);
    view.setUint32(4, crc, true);
    view.setUint32(8, csize, true);
    view.setUint32(12, size, true);
    yield descriptor;
    offset += descriptor.length;
    directory.push({ nameBytes, crc, size, csize, offset: start });
  }
  yield zipDirectory(directory, offset, stamp);
}

async function* piecesOf(data: ZipStreamEntry["data"]): AsyncGenerator<Uint8Array> {
  if (typeof data === "string") {
    yield utf8Encode(data);
    return;
  }
  if (data instanceof Uint8Array) {
    yield data;
    return;
  }
  for await (const piece of data) yield typeof piece === "string" ? utf8Encode(piece) : piece;
}

/** One piece as deflate blocks ending on a byte boundary, the stream left open for the next. */
function deflatePiece(piece: Uint8Array, level: number): Uint8Array | Promise<Uint8Array> {
  const opts = { level, finishFlush: constants.Z_SYNC_FLUSH };
  if (piece.length <= INLINE_MAX) return deflateRawSync(piece, opts);
  return new Promise((resolve, reject) => {
    deflateRaw(piece, opts, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

function localHeader(nameBytes: Uint8Array, stamp: { time: number; date: number }): Uint8Array {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, SIG_LOCAL, true);
  view.setUint16(4, 20, true);                     // version needed
  view.setUint16(6, FLAGS, true);
  view.setUint16(8, METHOD_DEFLATE, true);
  view.setUint16(10, stamp.time, true);
  view.setUint16(12, stamp.date, true);
  // CRC and both sizes are zero here: the data descriptor carries them.
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);                     // extra length
  header.set(nameBytes, 30);
  return header;
}

/**
 * The central directory and the end records for entries written from offset
 * 0 up to `cdStart`. Exported for the tests, which cannot write 4 GB to
 * reach the ZIP64 offsets.
 */
export function zipDirectory(entries: readonly ZipDirEntry[], cdStart: number, stamp: { time: number; date: number }): Uint8Array {
  const far = (n: number) => n >= U32_MAX;
  let cdSize = 0;
  for (const e of entries) cdSize += 46 + e.nameBytes.length + (far(e.offset) ? 12 : 0);
  const cdEnd = cdStart + cdSize;
  const zip64 = entries.length >= U16_MAX || far(cdStart) || far(cdSize) || far(cdEnd);
  const out = new Uint8Array(cdSize + (zip64 ? 56 + 20 : 0) + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const e of entries) {
    const big = far(e.offset);
    view.setUint32(at, SIG_CD, true); at += 4;
    view.setUint16(at, big ? 45 : 20, true); at += 2;           // version made by
    view.setUint16(at, big ? 45 : 20, true); at += 2;           // version needed
    view.setUint16(at, FLAGS, true); at += 2;
    view.setUint16(at, METHOD_DEFLATE, true); at += 2;
    view.setUint16(at, stamp.time, true); at += 2;
    view.setUint16(at, stamp.date, true); at += 2;
    view.setUint32(at, e.crc, true); at += 4;
    view.setUint32(at, e.csize, true); at += 4;
    view.setUint32(at, e.size, true); at += 4;
    view.setUint16(at, e.nameBytes.length, true); at += 2;
    view.setUint16(at, big ? 12 : 0, true); at += 2;            // extra length
    view.setUint16(at, 0, true); at += 2;                       // comment length
    view.setUint16(at, 0, true); at += 2;                       // disk
    view.setUint16(at, 0, true); at += 2;                       // internal attrs
    view.setUint32(at, 0, true); at += 4;                       // external attrs
    view.setUint32(at, big ? U32_MAX : e.offset, true); at += 4;
    out.set(e.nameBytes, at); at += e.nameBytes.length;
    if (big) {
      view.setUint16(at, 0x0001, true); at += 2;                // ZIP64 extra
      view.setUint16(at, 8, true); at += 2;
      view.setBigUint64(at, BigInt(e.offset), true); at += 8;
    }
  }
  if (zip64) {
    view.setUint32(at, SIG_ZIP64_EOCD, true); at += 4;
    view.setBigUint64(at, BigInt(44), true); at += 8;           // size of the rest of this record
    view.setUint16(at, 45, true); at += 2;                      // version made by
    view.setUint16(at, 45, true); at += 2;                      // version needed
    view.setUint32(at, 0, true); at += 4;                       // this disk
    view.setUint32(at, 0, true); at += 4;                       // directory disk
    view.setBigUint64(at, BigInt(entries.length), true); at += 8;
    view.setBigUint64(at, BigInt(entries.length), true); at += 8;
    view.setBigUint64(at, BigInt(cdSize), true); at += 8;
    view.setBigUint64(at, BigInt(cdStart), true); at += 8;
    view.setUint32(at, SIG_ZIP64_LOCATOR, true); at += 4;
    view.setUint32(at, 0, true); at += 4;                       // disk with the ZIP64 record
    view.setBigUint64(at, BigInt(cdEnd), true); at += 8;        // where the ZIP64 record starts
    view.setUint32(at, 1, true); at += 4;                       // total disks
  }
  view.setUint32(at, SIG_EOCD, true); at += 4;
  view.setUint16(at, 0, true); at += 2;                         // disk
  view.setUint16(at, 0, true); at += 2;                         // start disk
  // Only a field that overflows carries the marker; the ZIP64 record has
  // every true value (Info-ZIP writes it the same way).
  const count = entries.length >= U16_MAX ? U16_MAX : entries.length;
  view.setUint16(at, count, true); at += 2;
  view.setUint16(at, count, true); at += 2;
  view.setUint32(at, far(cdSize) ? U32_MAX : cdSize, true); at += 4;
  view.setUint32(at, far(cdStart) ? U32_MAX : cdStart, true); at += 4;
  view.setUint16(at, 0, true);                                  // comment length
  return out;
}

/** MS-DOS date and time fields, from the UTC clock, clamped to the years they can hold. */
export function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getUTCFullYear(), 1980), 2107);
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}
