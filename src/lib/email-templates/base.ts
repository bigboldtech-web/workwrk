// Base HTML email wrapper used by all templates
export function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0A0A0F; color: #E8E8F0; }
    .container { max-width: 560px; margin: 0 auto; padding: 40px 20px; }
    .card { background: #111118; border: 1px solid #2A2A3A; border-radius: 12px; padding: 32px; }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo span { font-size: 20px; font-weight: 700; color: #d4ff2e; }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; color: #E8E8F0; }
    p { font-size: 14px; line-height: 1.6; color: #8888A0; margin: 0 0 16px; }
    .btn { display: inline-block; padding: 10px 24px; background: #d4ff2e; color: #0a0a0a !important; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600; }
    .btn:hover { background: #e2ff6b; }
    .meta { font-size: 12px; color: #6B6B80; margin-top: 16px; }
    .divider { border: none; border-top: 1px solid #2A2A3A; margin: 24px 0; }
    .footer { text-align: center; font-size: 11px; color: #6B6B80; margin-top: 32px; }
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
