// Base HTML email wrapper used by every template (spec-account-auth A2).
//
// White and blue, on the product's own light tokens (design-system 1.2), so
// an email and the page its button opens look like one product:
//   ground        #F6F7F9  --os-surface-1 (N50)
//   card          #FFFFFF  --os-surface, 1px #E4E7EC (--os-line), radius 8
//   text          #1F2430  --os-ink
//   secondary     #5C6779  --os-ink-2
//   meta          #667085  a step lighter, for the small print only
//   button        #0073EA  --os-brand, white label (4.53:1)
//   link          #0B5FC2  --os-brand-deep
// Inter first, then the system stack; no web font is loaded (strict mail
// clients strip it, and a missing font must not change the layout). The
// logo is the four brand dots in a row plus the wordmark, drawn in HTML so
// it survives clients that block images.
//
// Every value interpolated into a template is escaped by the template with
// escapeHtml (./escape.ts): names, company names and messages are typed by
// people.

export const EMAIL_COLORS = {
  ground: "#F6F7F9",
  card: "#FFFFFF",
  line: "#E4E7EC",
  ink: "#1F2430",
  ink2: "#5C6779",
  meta: "#667085",
  brand: "#0073EA",
  link: "#0B5FC2",
  soft: "#EAF3FE",
} as const;

const DOTS = ["#FFCB00", "#0073EA", "#FF3D57", "#00C875"];

function logo(): string {
  const dots = DOTS.map(
    (c) => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:3px;vertical-align:middle;"></span>`,
  ).join("");
  return `<div class="logo">${dots}<span class="wordmark">WorkwrK</span></div>`;
}

/** A primary button with inline styles, for clients that drop the <style> block. `href` must already be safe (escape.ts safeHref). */
export function emailButton(href: string, label: string): string {
  return `<a href="${href}" class="btn" style="display:inline-block;padding:10px 20px;background:${EMAIL_COLORS.brand};color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">${label}</a>`;
}

export function baseLayout(content: string): string {
  const c = EMAIL_COLORS;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <style>
    body { margin: 0; padding: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: ${c.ground}; color: ${c.ink}; }
    .container { max-width: 560px; margin: 0 auto; padding: 32px 16px; }
    .card { background: ${c.card}; border: 1px solid ${c.line}; border-radius: 8px; padding: 32px; }
    .logo { margin: 0 0 20px 4px; line-height: 20px; }
    .wordmark { font-size: 16px; font-weight: 600; color: ${c.ink}; vertical-align: middle; margin-left: 4px; }
    h1 { font-size: 20px; line-height: 28px; font-weight: 600; margin: 0 0 12px; color: ${c.ink}; }
    p { font-size: 14px; line-height: 22px; color: ${c.ink2}; margin: 0 0 16px; }
    a { color: ${c.link}; }
    .btn { display: inline-block; padding: 10px 20px; background: ${c.brand}; color: #FFFFFF !important; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 500; }
    .meta { font-size: 12px; line-height: 18px; color: ${c.meta}; margin-top: 16px; }
    .url { word-break: break-all; color: ${c.link}; }
    .divider { border: none; border-top: 1px solid ${c.line}; margin: 24px 0; }
    .footer { text-align: center; margin-top: 24px; }
    .footer p { font-size: 12px; line-height: 18px; color: ${c.meta}; }
    .highlight { color: ${c.ink}; font-weight: 600; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; background: ${c.soft}; color: ${c.link}; }
    .quote { border-left: 3px solid ${c.brand}; padding: 8px 12px; background: ${c.ground}; border-radius: 4px; white-space: pre-wrap; color: ${c.ink}; }
    .facts { margin: 0 0 16px; padding: 0; list-style: none; }
    .facts li { font-size: 14px; line-height: 22px; color: ${c.ink2}; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${c.ground};">
  <div class="container">
    ${logo()}
    <div class="card">
      ${content}
    </div>
    <div class="footer">
      <p>This email was sent by WorkwrK. If you did not expect it, you can ignore it.</p>
    </div>
  </div>
</body>
</html>`;
}
