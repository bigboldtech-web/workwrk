// Base HTML email wrapper used by all templates.
//
// Palette is kept in lockstep with the dark-mode tokens in
// src/app/globals.css — the dashboard force-applies `.dark`, so the
// app users actually see is always dark-themed, and we match that here.
//   --color-background         #0a0a0a
//   --color-foreground         #fafafa
//   --color-surface            #141414
//   --color-muted              #a0a0a0
//   --color-muted-2            #707070
//   --color-border (dark)      rgba(255,255,255,0.08) → #1f1f1f hex for mail clients
//   --color-accent             #d4ff2e
// Font stack leads with Outfit (pulled from Google Fonts) and falls
// back to the same system stack the app uses so the email still looks
// right even when Outfit is stripped by strict mail clients.
export function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    body { margin: 0; padding: 0; font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a; color: #fafafa; }
    .container { max-width: 560px; margin: 0 auto; padding: 40px 20px; }
    .card { background: #141414; border: 1px solid #1f1f1f; border-radius: 12px; padding: 32px; }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo span { font-size: 20px; font-weight: 700; color: #d4ff2e; letter-spacing: -0.01em; }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; color: #fafafa; letter-spacing: -0.01em; }
    p { font-size: 14px; line-height: 1.6; color: #a0a0a0; margin: 0 0 16px; }
    .btn { display: inline-block; padding: 10px 24px; background: #d4ff2e; color: #0a0a0a !important; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600; }
    .btn:hover { background: #e2ff6b; }
    .meta { font-size: 12px; color: #707070; margin-top: 16px; }
    .divider { border: none; border-top: 1px solid #1f1f1f; margin: 24px 0; }
    .footer { text-align: center; font-size: 11px; color: #707070; margin-top: 32px; }
    .highlight { color: #d4ff2e; font-weight: 500; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo"><span>WorkwrK</span></div>
    <div class="card">
      ${content}
    </div>
    <div class="footer">
      <p>This email was sent by WorkwrK. If you didn't expect this, you can safely ignore it.</p>
    </div>
  </div>
</body>
</html>`;
}
