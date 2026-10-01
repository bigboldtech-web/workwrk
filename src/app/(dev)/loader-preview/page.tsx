// /loader-preview: a local eyeball of the four-dot loader (spec-account-auth
// section 0, B27). It used to ship as a public, unauthenticated route in the
// production bundle; now it renders only when NODE_ENV is not "production"
// and is the in-shell 404 otherwise. The loader's markup is pinned by a
// vitest snapshot (src/components/brand/dots-loader.test.ts), which is the
// check that runs everywhere.
import { notFound } from "next/navigation";
import { DotsLoader } from "@/components/brand/dots-loader";

export const dynamic = "force-dynamic";

export default function LoaderPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main style={{ display: "grid", gap: 32, padding: 48, background: "#FFFFFF", minHeight: "100vh", alignContent: "start" }}>
      <DotsLoader size={24} />
      <DotsLoader size={40} label="Loading workspace" />
      <DotsLoader size={64} />
    </main>
  );
}
