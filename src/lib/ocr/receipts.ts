// Receipt OCR adapter.
//
// Expense flows let users attach a receipt image / PDF; this
// service runs OCR + heuristic field extraction so the form
// auto-fills (vendor, total, date, currency, line items). Multiple
// providers fit: Google Cloud Vision, AWS Textract, Mindee
// Receipts, Tesseract.js (local). The user's vendor pick lands here.
//
// The interface returns a discriminated union so call sites can
// branch on confidence: a high-confidence parse can pre-submit
// while a low-confidence one drops the user into a manual review
// dialog.

export type ReceiptParseInput = {
  // The asset URL or buffer of the receipt. Adapter resolves
  // whichever it accepts.
  url?: string;
  base64?: string;
};

export type ReceiptLineItem = {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
};

export type ReceiptParseResult =
  | {
      ok: true;
      provider: string;
      confidence: number;             // 0..1
      vendor: string | null;
      total: number | null;
      currency: string | null;        // ISO 4217
      date: Date | null;
      lineItems: ReceiptLineItem[];
      rawText: string;                // for audit / fallback display
    }
  | {
      ok: false;
      provider: string;
      reason: string;
    };

export interface ReceiptOcrAdapter {
  parse(input: ReceiptParseInput): Promise<ReceiptParseResult>;
  isReady(): Promise<boolean>;
}

export class StubReceiptOcrAdapter implements ReceiptOcrAdapter {
  async parse(_input: ReceiptParseInput): Promise<ReceiptParseResult> {
    // Until a real provider is wired, return a graceful failure so
    // the UI can fall back to manual entry.
    return {
      ok: false,
      provider: "stub",
      reason: "Receipt OCR not configured. Wire Google Vision, AWS Textract, or Mindee.",
    };
  }
  async isReady() { return false; }
}

let _adapter: ReceiptOcrAdapter | null = null;
export function getReceiptOcr(): ReceiptOcrAdapter {
  if (_adapter) return _adapter;
  _adapter = new StubReceiptOcrAdapter();
  return _adapter;
}
