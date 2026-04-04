import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getSessionOrFail } from "@/lib/api-helpers";

export async function GET() {
  const { error } = await getSessionOrFail();
  if (error) return error;

  try {
    const zipPath = path.join(process.cwd(), "public", "workwrk-sop-recorder.zip");
    const buffer = await readFile(zipPath);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=workwrk-sop-recorder.zip",
      },
    });
  } catch {
    return NextResponse.json({ error: "Extension file not available" }, { status: 404 });
  }
}
