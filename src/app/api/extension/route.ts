import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { getSessionOrFail } from "@/lib/api-helpers";

// This endpoint returns extension info and download instructions
export async function GET() {
  const { error } = await getSessionOrFail();
  if (error) return error;

  // Check if extension directory exists
  const extensionDir = path.join(process.cwd(), "extension");

  try {
    const files = await readdir(extensionDir);
    const hasManifest = files.includes("manifest.json");

    let manifest = null;
    if (hasManifest) {
      const content = await readFile(path.join(extensionDir, "manifest.json"), "utf-8");
      manifest = JSON.parse(content);
    }

    return NextResponse.json({
      available: hasManifest,
      name: manifest?.name || "WorkwrK SOP Recorder",
      version: manifest?.version || "1.0",
      description: manifest?.description || "Record SOPs by capturing your screen actions",
      instructions: [
        "1. Download the extension files from the repository",
        "2. Open Chrome and go to chrome://extensions",
        "3. Enable 'Developer mode' (top right toggle)",
        "4. Click 'Load unpacked' and select the extension folder",
        "5. The WorkwrK SOP Recorder icon will appear in your toolbar",
        "6. Click the icon to start recording an SOP",
        "7. Navigate through the process you want to document",
        "8. Click 'Stop Recording' to save the SOP",
      ],
    });
  } catch {
    return NextResponse.json({ available: false, message: "Extension not available" });
  }
}
