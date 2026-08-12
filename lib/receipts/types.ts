export interface ReceiptItem {
  name: string | null;
  quantity: number | null;
  unit_price: number | null;
  total: number | null;
  discount: number | null;
  category: string | null;
  confidence: number;
}

export interface ReceiptExtraction {
  merchant: string | null;
  transaction_date: string | null;
  currency: string | null;
  items: ReceiptItem[];
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  discount: number | null;
  total: number | null;
  confidence: number;
  source: string;
}