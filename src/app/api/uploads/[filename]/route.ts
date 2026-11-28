import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { readUpload } from "@/lib/local-uploads";
import { authOptions } from "@/lib/auth";
import { personHere } from "@/lib/access/seated-here";

/** "file-<companyId>-...": the company an attachment was uploaded in. */
const FILE_COMPANY = /^file-([a-z0-9]{20,32})-/i;

// Images show in the page; every other file downloads, never opens as a page
// of the app. An image opened on its own is sandboxed (the uploads rule in
// next.config.ts), so an SVG with a script in it runs nothing.
const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Prevent path traversal
  if (filename.includes("..") || filename.includes("/")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";

  // An attachment is its company's (pen test 2026-11-28, V-23, the final
  // review): anyone with the URL downloaded it, for ever, a former member or
  // a removed guest included. A file needs someone signed in with a live seat
  // in the company its name carries (an older name without one, anyone signed
  // in). Images (avatars, logos, pictures in a page or a public share) stay
  // open, as the pages that show them need.
  if (!MIME_TYPES[ext]) {
    const session = await getServerSession(authOptions).catch(() => null);
    const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
    if (!userId) {
      return NextResponse.json({ error: "Sign in to WorkwrK to download this file." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const company = FILE_COMPANY.exec(filename)?.[1] ?? null;
    if (company && !(await personHere(company, userId, "live"))) {
      return NextResponse.json({ error: "File not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
  }

  try {
    // storage/uploads, or public/uploads for a file not moved yet.
    const buffer = await readUpload(filename);
    if (!buffer) return NextResponse.json({ error: "File not found" }, { status: 404 });

    // Images (avatars, logos, pictures in a page) stay cacheable anywhere. A
    // file is someone's attachment: no shared cache keeps a copy, and no
    // browser keeps it past an hour (pen test 2026-11-28, V-23: every file
    // here was "public, immutable" for a year, so a proxy or CDN could serve
    // it long after the person lost access or the file was trashed).
    const image = !!MIME_TYPES[ext];
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": image ? "public, max-age=31536000, immutable" : "private, max-age=3600",
        "X-Robots-Tag": "noindex",
        ...(image ? {} : { "Content-Disposition": "attachment" }),
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
