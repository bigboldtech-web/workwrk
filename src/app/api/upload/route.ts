import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "File too large. Max 10MB." }, { status: 400 });

  const ext = file.name.split(".").pop() || "bin";
  const safeName = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadDir, safeName), buffer);

  return NextResponse.json({ url: `/api/uploads/${safeName}`, name: file.name, size: file.size });
}
