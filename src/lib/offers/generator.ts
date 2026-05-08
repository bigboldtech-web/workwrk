// Offer letter generator.
//
// Generates a PDF (or HTML for preview) for a candidate's offer
// from a template. The template is a simple Mustache-style string
// stored on the org so legal can edit without redeploying. PDF
// rendering uses a real library (pdfkit, react-pdf, or playwright
// HTML→PDF) once the user confirms the toolchain — the interface
// here keeps the call site stable.

export type OfferContext = {
  candidate: {
    firstName: string;
    lastName: string;
    email: string;
  };
  job: {
    title: string;
    location: string | null;
    startDate: Date | null;
    salary: number | null;
    salaryCurrency: string;
    employmentType: string;
  };
  org: {
    name: string;
    addressLine: string | null;
  };
  // Free-form fields a template may reference (sign-on bonus,
  // equity grant, special clauses).
  extras?: Record<string, string | number>;
};

export type OfferRenderResult =
  | { ok: true; format: "pdf" | "html"; bytes: Buffer; mime: string; filename: string }
  | { ok: false; reason: string };

export interface OfferLetterRenderer {
  render(template: string, context: OfferContext): Promise<OfferRenderResult>;
  isReady(): Promise<boolean>;
}

/**
 * Naive HTML renderer — substitutes {{var}} placeholders with
 * context values. Always available; no dependencies. Real PDF
 * generation is layered in later.
 */
export class HtmlOfferRenderer implements OfferLetterRenderer {
  async render(template: string, context: OfferContext): Promise<OfferRenderResult> {
    const flat: Record<string, string> = {
      candidate_first_name: context.candidate.firstName,
      candidate_last_name: context.candidate.lastName,
      candidate_email: context.candidate.email,
      job_title: context.job.title,
      job_location: context.job.location ?? "",
      job_start_date: context.job.startDate?.toLocaleDateString() ?? "",
      job_salary: context.job.salary != null ? String(context.job.salary) : "",
      job_salary_currency: context.job.salaryCurrency,
      job_employment_type: context.job.employmentType,
      org_name: context.org.name,
      org_address: context.org.addressLine ?? "",
    };
    if (context.extras) {
      for (const [k, v] of Object.entries(context.extras)) {
        flat[k] = String(v);
      }
    }
    const out = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => flat[k] ?? "");
    const html = `<!doctype html><meta charset="utf-8"><title>Offer Letter</title><style>body{font:14px/1.5 Georgia,serif;max-width:680px;margin:48px auto;color:#111}h1{font-size:18px}p{margin:12px 0}</style>${out}`;
    return {
      ok: true,
      format: "html",
      bytes: Buffer.from(html, "utf8"),
      mime: "text/html",
      filename: `offer-${context.candidate.lastName.toLowerCase()}.html`,
    };
  }
  async isReady() { return true; }
}

let _renderer: OfferLetterRenderer | null = null;
export function getOfferRenderer(): OfferLetterRenderer {
  if (_renderer) return _renderer;
  _renderer = new HtmlOfferRenderer();
  return _renderer;
}
