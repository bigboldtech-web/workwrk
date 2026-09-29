import { baseLayout } from "./base";

interface DocumentSignVars {
  documentTitle: string;
  signerName?: string;
  signLink: string; // ${baseUrl}/sign/${token}
}

export function documentSignTemplate(vars: DocumentSignVars): { subject: string; html: string } {
  const html = baseLayout(`
    <h1>Document to sign</h1>
    <p>${vars.signerName ? `Hi ${vars.signerName}, you` : "You"} have been asked to review and sign a document:</p>
    <div style="background: #F6F7F9; border: 1px solid #E4E7EC; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0; color: #1F2430; font-weight: 600;">${vars.documentTitle}</p>
    </div>
    <p style="text-align: center;">
      <a href="${vars.signLink}" class="btn">Review &amp; sign</a>
    </p>
    <p style="font-size: 12px; color: #5C6779;">This is a personal signing link. Please don't forward it.</p>
  `);

  return {
    subject: `Please sign: ${vars.documentTitle}`,
    html,
  };
}
