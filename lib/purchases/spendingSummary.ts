import type { Purchase } from "./types";

export type SpendingSummaryStatus =
  | "empty"
  | "single_currency"
  | "mixed_currency"
  | "unknown_currency";

export interface SpendingCategoryTotal {
  category: string;
  total: number;
}

export interface SpendingSummary {
  status: SpendingSummaryStatus;
  currency: string | null;
  total: number | null;
  categoryTotals: SpendingCategoryTotal[];
}

function normalizedCurrency(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export function summarizeSpending(purchases: Purchase[]): SpendingSummary {
  const included = purchases.filter(
    (purchase) =>
      purchase.amount !== null && Number.isFinite(purchase.amount)
  );

  if (included.length === 0) {
    return {
      status: "empty",
      currency: null,
      total: null,
      categoryTotals: [],
    };
  }

  const currencies = new Set<string>();
  for (const purchase of included) {
    const currency = normalizedCurrency(purchase.currency);
    if (currency === null) {
      return {
        status: "unknown_currency",
        currency: null,
        total: null,
        categoryTotals: [],
      };
    }
    currencies.add(currency);
  }

  if (currencies.size !== 1) {
    return {
      status: "mixed_currency",
      currency: null,
      total: null,
      categoryTotals: [],
    };
  }

  const currency = [...currencies][0];
  const categoryMap = new Map<string, number>();
  let total = 0;

  for (const purchase of included) {
    const amount = purchase.amount as number;
    total += amount;
    if (purchase.category) {
      categoryMap.set(
        purchase.category,
        (categoryMap.get(purchase.category) ?? 0) + amount
      );
    }
  }

  return {
    status: "single_currency",
    currency,
    total,
    categoryTotals: Array.from(categoryMap.entries())
      .map(([category, categoryTotal]) => ({
        category,
        total: categoryTotal,
      }))
      .sort((a, b) => b.total - a.total),
  };
}
