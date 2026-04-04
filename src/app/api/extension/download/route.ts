import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { getSessionOrFail } from "@/lib/api-helpers";

export async function GET() {
  const { error } = await getSessionOrFail();
  if (error) return error;

  const extensionDir = path.join(process.cwd(), "extension");

  try {
    // Create a simple zip-like concatenation of files
    // For a proper solution, we'd use archiver, but let's serve the manifest + files as JSON
    // that the client can use to reconstruct
    const files = await readdir(extensionDir, { recursive: true });
    const fileData: Record<string, string> = {};

    for (const file of files) {
      const filePath = path.join(extensionDir, file as string);
      try {
        const content = await readFile(filePath, "utf-8");
        fileData[file as string] = content;
      } catch {
        // Skip binary files or directories
      }
    }

    // Return as downloadable JSON that contains all extension files
    return NextResponse.json({
      name: "workwrk-sop-recorder",
      version: "1.0.0",
      files: fileData,
      instructions: "Extract these files to a folder, then load as unpacked extension in Chrome.",
    });
  } catch {
    return NextResponse.json({ error: "Extension files not available" }, { status: 404 });
  }
}
