/**
 * Minimal pure-JS ZIP encoder. "Stored" mode (no compression) — fine for
 * CSV/JSON payloads in the tens-of-MB range. Avoids adding jszip/fflate
 * to the bundle.
 *
 * Output is a valid PKZIP file readable by every standard tool. We keep
 * the encoder small and side-effect-free so it can run on Edge.
 *
 * Reference: APPNOTE.TXT v6.3.4
 */

interface ZipFile {
  name: string;
  data: Uint8Array;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** Encode a list of files as a single ZIP archive. */
export function zipFiles(files: ZipFile[]): Uint8Array {
  // First pass: compute total size + per-file metadata so we can size
  // the output buffer in one allocation.
  const meta = files.map((f) => {
    const nameBytes = utf8Encode(f.name);
    const crc = crc32(f.data);
    return {
      name: f.name,
      nameBytes,
      data: f.data,
      crc,
      size: f.data.length,
    };
  });

  let localTotal = 0;
  for (const m of meta) {
    localTotal += 30 + m.nameBytes.length + m.size;
  }
  let cdTotal = 0;
  for (const m of meta) {
    cdTotal += 46 + m.nameBytes.length;
  }
  const total = localTotal + cdTotal + 22;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  const localOffsets: number[] = [];

  // Local file headers + raw data.
  for (const m of meta) {
    localOffsets.push(offset);
    view.setUint32(offset, SIG_LOCAL, true); offset += 4;
    view.setUint16(offset, 20, true); offset += 2;             // version needed
    view.setUint16(offset, 0, true); offset += 2;              // flags
    view.setUint16(offset, 0, true); offset += 2;              // method = stored
    view.setUint16(offset, 0, true); offset += 2;              // mod time
    view.setUint16(offset, 0x21, true); offset += 2;           // mod date (1980-01-01)
    view.setUint32(offset, m.crc, true); offset += 4;
    view.setUint32(offset, m.size, true); offset += 4;         // compressed size
    view.setUint32(offset, m.size, true); offset += 4;         // uncompressed size
    view.setUint16(offset, m.nameBytes.length, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;              // extra length
    out.set(m.nameBytes, offset); offset += m.nameBytes.length;
    out.set(m.data, offset); offset += m.size;
  }

  // Central directory.
  const cdStart = offset;
  for (let i = 0; i < meta.length; i++) {
    const m = meta[i];
    view.setUint32(offset, SIG_CD, true); offset += 4;
    view.setUint16(offset, 20, true); offset += 2;             // version made by
    view.setUint16(offset, 20, true); offset += 2;             // version needed
    view.setUint16(offset, 0, true); offset += 2;              // flags
    view.setUint16(offset, 0, true); offset += 2;              // method
    view.setUint16(offset, 0, true); offset += 2;              // mod time
    view.setUint16(offset, 0x21, true); offset += 2;           // mod date
    view.setUint32(offset, m.crc, true); offset += 4;
    view.setUint32(offset, m.size, true); offset += 4;
    view.setUint32(offset, m.size, true); offset += 4;
    view.setUint16(offset, m.nameBytes.length, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;              // extra length
    view.setUint16(offset, 0, true); offset += 2;              // comment length
    view.setUint16(offset, 0, true); offset += 2;              // disk
    view.setUint16(offset, 0, true); offset += 2;              // internal attrs
    view.setUint32(offset, 0, true); offset += 4;              // external attrs
    view.setUint32(offset, localOffsets[i], true); offset += 4;
    out.set(m.nameBytes, offset); offset += m.nameBytes.length;
  }
  const cdSize = offset - cdStart;

  // End of central directory.
  view.setUint32(offset, SIG_EOCD, true); offset += 4;
  view.setUint16(offset, 0, true); offset += 2;                // disk
  view.setUint16(offset, 0, true); offset += 2;                // start disk
  view.setUint16(offset, meta.length, true); offset += 2;      // disk entries
  view.setUint16(offset, meta.length, true); offset += 2;      // total entries
  view.setUint32(offset, cdSize, true); offset += 4;
  view.setUint32(offset, cdStart, true); offset += 4;
  view.setUint16(offset, 0, true); offset += 2;                // comment length

  return out;
}

/** Convenience: build a file from a UTF-8 string. */
export function zipTextFile(name: string, content: string): ZipFile {
  return { name, data: utf8Encode(content) };
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// CRC-32/ISO-HDLC table built once at module load.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
