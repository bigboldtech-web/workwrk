import { NextRequest, NextResponse } from "next/server";
import { readUpload } from "@/lib/local-uploads";

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

  try {
    // storage/uploads, or public/uploads for a file not moved yet.
    const buffer = await readUpload(filename);
    if (!buffer) return NextResponse.json({ error: "File not found" }, { status: 404 });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
        ...(MIME_TYPES[ext] ? {} : { "Content-Disposition": "attachment" }),
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
