// Route-transition loader (spec-shell 2.2, design-system 5.15). The body is
// RouteLoadingView, shared with the Work placement provider's correction
// state so both read as the same load; see route-loading-view.tsx.

import { RouteLoadingView } from "@/components/layout/os/route-loading-view";

export default function Loading() {
  return <RouteLoadingView />;
}
