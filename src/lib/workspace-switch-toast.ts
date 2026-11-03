// The workspace menu's toast when a switch fails (src/components/layout/os/workspace-menu.tsx).
// A 403 is a refusal, not a blip: the seat there was ended, or the workspace
// is closed (POST /api/me/switch-org), so a Retry could only fail again and
// none is offered (docs/plans/workspace-status.md, the final review, product
// L4). Anything else offers Retry, as before. Pure.

export function switchFailAction(status: number, retry: () => void): { action?: { label: string; onClick: () => void } } {
  return status === 403 ? {} : { action: { label: "Retry", onClick: retry } };
}
