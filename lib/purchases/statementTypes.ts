/**
 * Statement transaction type for the Unified Purchase Engine.
 *
 * A single transaction parsed from a bank/card statement. This is an
 * intermediate representation that will be adapted into the canonical
 * Purchase model by purchaseFromStatement.
 */
export interface StatementTransaction {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  currency: string | null;
  cardId: string | null;
  category: string | null;
  categorySource?: "statement" | "inferred";
  confidence: number;
}
