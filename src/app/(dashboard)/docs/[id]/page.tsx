"use client";

// /docs/[id] — full-screen Doc viewer. Resolves a copy-link target so
// anyone with access to the org can land directly on a Doc.

import { use } from "react";
import { useRouter } from "next/navigation";
import { FullScreenDocEditor } from "@/components/docs/full-screen-doc-editor";

export default function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  return (
    <FullScreenDocEditor
      docId={id}
      onClose={() => router.back()}
    />
  );
}
