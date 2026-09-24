// Start a browser download of a same-origin URL (an API route that answers
// with Content-Disposition: attachment) without leaving the page. A menu row
// must not be a client-side <Link> to /api/...: the router would try to
// fetch it as a page.

export function downloadUrl(url: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
