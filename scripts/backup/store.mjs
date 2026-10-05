// The backup store: an S3-compatible bucket that is NOT the app's own (other
// credentials, ideally another provider or region), or, for a test run only,
// a local folder. Used by scripts/backup/backup.sh and by hand to restore
// (scripts/BACKUPS.md).
//
//   node scripts/backup/store.mjs put <file> <key>
//   node scripts/backup/store.mjs get <key> <file>
//   node scripts/backup/store.mjs list [prefix]
//   node scripts/backup/store.mjs prune <prefix> <days>
//
// Settings (from /etc/workwrk-backup.env, see BACKUPS.md):
//   BACKUP_S3_BUCKET, BACKUP_S3_REGION, BACKUP_S3_ACCESS_KEY_ID,
//   BACKUP_S3_SECRET_ACCESS_KEY, and BACKUP_S3_ENDPOINT /
//   BACKUP_S3_FORCE_PATH_STYLE for a provider other than AWS.
//   BACKUP_LOCAL_DIR instead of the bucket: a folder, for a test run.
//
// It prints keys, sizes and dates only, never a setting's value.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync, openSync, readSync, closeSync } from "fs";
import { dirname, join } from "path";
import { pipeline } from "stream/promises";
import {
  S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadObjectCommand,
} from "@aws-sdk/client-s3";

const PART = 64 * 1024 * 1024; // multipart above this size, in parts of it
const env = process.env;
const localDir = env.BACKUP_LOCAL_DIR?.trim();
const bucket = env.BACKUP_S3_BUCKET?.trim();

function die(msg) {
  console.error(`backup store: ${msg}`);
  process.exit(1);
}

if (!localDir && !bucket) die("no destination: set BACKUP_S3_BUCKET (or BACKUP_LOCAL_DIR for a test run)");
if (localDir && bucket) die("set BACKUP_S3_BUCKET or BACKUP_LOCAL_DIR, not both");

const s3 = bucket
  ? new S3Client({
      region: env.BACKUP_S3_REGION || "us-east-1",
      endpoint: env.BACKUP_S3_ENDPOINT || undefined,
      forcePathStyle: env.BACKUP_S3_FORCE_PATH_STYLE === "true",
      credentials: { accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID || "", secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY || "" },
    })
  : null;

const safeKey = (k) => {
  if (!k || k.startsWith("/") || k.includes("..")) die(`refusing the key "${k}"`);
  return k;
};

async function put(file, key) {
  safeKey(key);
  const size = statSync(file).size;
  if (localDir) {
    const dest = join(localDir, key);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
  } else if (size <= PART) {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(file), ContentLength: size }));
  } else {
    const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }));
    const parts = [];
    const fd = openSync(file, "r");
    try {
      for (let n = 1, off = 0; off < size; n++, off += PART) {
        const len = Math.min(PART, size - off);
        const buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, off);
        const { ETag } = await s3.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId, PartNumber: n, Body: buf, ContentLength: len }));
        parts.push({ ETag, PartNumber: n });
      }
      await s3.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId, MultipartUpload: { Parts: parts } }));
    } catch (err) {
      await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId })).catch(() => {});
      throw err;
    } finally {
      closeSync(fd);
    }
  }
  // Read the size back from the store: an upload that did not land whole fails here.
  const stored = localDir
    ? statSync(join(localDir, key)).size
    : (await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).ContentLength;
  if (stored !== size) die(`${key} stored ${stored} bytes of ${size}`);
  console.log(`stored ${key} (${size} bytes)`);
}

async function get(key, file) {
  safeKey(key);
  if (localDir) {
    copyFileSync(join(localDir, key), file);
  } else {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    await pipeline(res.Body, createWriteStream(file));
  }
  console.log(`fetched ${key} to ${file} (${statSync(file).size} bytes)`);
}

async function list(prefix = "") {
  const out = [];
  if (localDir) {
    const walk = (dir, rel) => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(dir, e.name), r);
        else if (r.startsWith(prefix)) { const st = statSync(join(dir, e.name)); out.push({ key: r, size: st.size, at: st.mtime }); }
      }
    };
    walk(localDir, "");
  } else {
    let token;
    do {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) out.push({ key: o.Key, size: o.Size, at: o.LastModified });
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

async function prune(prefix, days) {
  const n = Number(days);
  if (!prefix || !Number.isFinite(n) || n < 1) die("prune needs a prefix and a number of days of at least 1");
  const cutoff = Date.now() - n * 86_400_000;
  const all = await list(prefix);
  const old = all.filter((o) => new Date(o.at).getTime() < cutoff);
  // Never the newest copy, however old it is: a backup that stopped running
  // must not be pruned down to nothing.
  const newest = all.reduce((m, o) => (!m || new Date(o.at) > new Date(m.at) ? o : m), null);
  const doomed = old.filter((o) => o.key !== newest?.key);
  if (localDir) for (const o of doomed) unlinkSync(join(localDir, o.key));
  else for (let i = 0; i < doomed.length; i += 1000) {
    await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: doomed.slice(i, i + 1000).map((o) => ({ Key: o.key })) } }));
  }
  console.log(`pruned ${doomed.length} of ${all.length} under ${prefix} older than ${n} days`);
}

const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === "put" && a && b) await put(a, b);
  else if (cmd === "get" && a && b) await get(a, b);
  else if (cmd === "list") for (const o of await list(a ?? "")) console.log(`${new Date(o.at).toISOString()}  ${String(o.size).padStart(12)}  ${o.key}`);
  else if (cmd === "prune" && a && b) await prune(a, b);
  else die("usage: put <file> <key> | get <key> <file> | list [prefix] | prune <prefix> <days>");
} catch (err) {
  die(err instanceof Error ? err.message : String(err));
}
