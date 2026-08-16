import type { Purchase } from "./types";

/**
 * Purchase History browsing helpers.
 *
 * Pure, framework-agnostic filtering and pagination logic for the dashboard
 * Purchase History experience. The dashboard loads the authenticated user's
 * Purchases once (the dataset is small for this MVP) and filters/paginates
 * them client-side. No database search infrastructure is used.
 *
 * Category filtering operates on the existing persisted/legacy category
 * values (e.g. "Dining", "Groceries", "Travel / Transportation"). Categories
 * are NOT migrated or normalized in this module.
 */

/** Filters applied to the Purchase History list. */
export interface PurchaseHistoryFilters {
  /** Free-text merchant search. Empty string means no search. */
  search: string;
  /** Exact persisted/legacy category value. Empty string means all categories. */
  category: string;
  /** "all" | "receipt" | "statement". */
  source: string;
}

/** Number of Purchases revealed per page / "Show more" increment. */
export const PURCHASE_HISTORY_PAGE_SIZE = 10;

/**
 * Filters Purchases by merchant search, exact category, and source.
 *
 * - Search matches a case-insensitive substring of the merchant name.
 * - Category matches the exact persisted/legacy category value.
 * - Source matches the Purchase source ("all" disables the filter).
 *
 * Purchases are returned in their original (newest-first) order.
 */
export function filterPurchases(
  purchases: Purchase[],
  filters: PurchaseHistoryFilters
): Purchase[] {
  const search = filters.search.trim().toLowerCase();

  return purchases.filter((purchase) => {
    if (filters.source !== "all" && purchase.source !== filters.source) {
      return false;
    }
    if (filters.category !== "" && purchase.category !== filters.category) {
      return false;
    }
    if (search) {
      const merchant = (purchase.merchant ?? "").toLowerCase();
      if (!merchant.includes(search)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Returns the distinct non-null category values present in the Purchases,
 * sorted alphabetically. Used to populate the category filter options.
 */
export function getDistinctCategories(purchases: Purchase[]): string[] {
  const set = new Set<string>();
  for (const purchase of purchases) {
    if (purchase.category) {
      set.add(purchase.category);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Returns the first `visibleCount` Purchases. Used for the incremental
 * "Show more" browsing mechanism. A non-positive count returns an empty list.
 */
export function getVisiblePurchases(
  purchases: Purchase[],
  visibleCount: number
): Purchase[] {
  return purchases.slice(0, Math.max(0, visibleCount));
}