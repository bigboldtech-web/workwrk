// POST /api/upload — multipart file upload for note attachments
// (images dropped/pasted into the block editor, file blocks, etc.)
//
// Production: writes to the org's S3 bucket via src/lib/s3.ts and
// returns a presigned GET URL valid for 1 hour. The client stores
// the s3Key alongside the url; doc reads re-presign so the URL is
// always fresh.
//
// Development fallback: when S3 isn't configured, writes to
// public/uploads (same as the previous implementation) so dev still
// works without setting AWS keys.

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { isS3Configured, getBucket, getS3Client, presignGetUrl } from "@/lib/s3";
import { resolveSuiteContext } from "@/lib/suites/auth";

const MAX_SIZE = 25 * 1024 * 1024; // 25MB — bumped from 10 for PDFs/screencaps

export async function POST(req: NextRequest) {
  const ctx = await resolveSuiteContext();
  if ("error" in ctx) return ctx.error;

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Missing form data" }, { status: 400 });

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: `File too large. Max ${MAX_SIZE / 1024 / 1024}MB.` }, { status: 400 });

  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const id = randomBytes(12).toString("hex");
  const today = new Date().toISOString().slice(0, 10);

  // S3 path — org-scoped so per-org bucket policies remain an option.
  if (isS3Configured()) {
    const key = `orgs/${ctx.orgId}/notes/${today}/${id}${ext ? "." + ext : ""}`;
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: getBucket(),
          Key: key,
          Body: buffer,
          ContentType: file.type || "application/octet-stream",
          CacheControl: "public, max-age=31536000, immutable",
        })
      );
      const url = await presignGetUrl(key, 3600);
      return NextResponse.json({
        url,
        s3Key: key,
        name: file.name,
        size: file.size,
        mimeType: file.type || null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "S3 upload failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Dev / single-instance fallback: write to public/uploads so the file
  // is reachable from the same Next server. Not production-grade — it
  // doesn't survive horizontal scaling — but keeps local dev frictionless.
  const safeName = `file-${id}.${ext || "bin"}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadDir, safeName), buffer);
  return NextResponse.json({
    url: `/api/uploads/${safeName}`,
    s3Key: null,
    name: file.name,
    size: file.size,
    mimeType: file.type || null,
  });
}
