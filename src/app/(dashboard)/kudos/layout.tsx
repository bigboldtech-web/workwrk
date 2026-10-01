// Kudos (/kudos): access step 3 (Phase 8 stage E). The app-key gate over its
// APP_RULES row (audience: every Member; Guests never), applied only with
// ACCESS_V2_RESOLVER on; off, the page is exactly as open as it was.
import { FlaggedAppKeyGate } from "@/components/access/app-key-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <FlaggedAppKeyGate appKey="kudos" label="Kudos" callbackUrl="/kudos" back={{ fallbackHref: "/people", label: "Directory" }}>
      {children}
    </FlaggedAppKeyGate>
  );
}
