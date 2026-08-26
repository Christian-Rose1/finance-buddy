"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ShoppingBag } from "lucide-react";
import type { Purchase } from "@/lib/purchases/types";
import {
  PURCHASE_HISTORY_PAGE_SIZE,
  filterPurchases,
  getDistinctCategories,
  getVisiblePurchases,
} from "@/lib/purchases/purchaseHistory";

function formatCurrency(value: number, currency: string | null): string {
  const code = currency && currency.length === 3 ? currency : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return date;
  }
}

/**
 * Client-side Purchase History browser.
 *
 * Receives the authenticated user's already-loaded Purchases (newest-first)
 * and provides merchant search, category filter, and source filter, plus an
 * incremental "Show more" browsing mechanism. Each result links to the
 * Purchase Detail page. Filtering/pagination logic lives in
 * `lib/purchases/purchaseHistory.ts`.
 */
export function PurchaseHistory({ purchases }: { purchases: Purchase[] }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("all");
  const [visibleCount, setVisibleCount] = useState(PURCHASE_HISTORY_PAGE_SIZE);

  const categories = useMemo(() => getDistinctCategories(purchases), [purchases]);

  const filtered = useMemo(
    () => filterPurchases(purchases, { search, category, source }),
    [purchases, search, category, source]
  );

  // Reset the visible window whenever the filters change. Adjusting state
  // during render is the React-recommended replacement for doing so in an
  // effect (avoids an extra render pass).
  const [prevFilters, setPrevFilters] = useState({ search, category, source });
  if (
    prevFilters.search !== search ||
    prevFilters.category !== category ||
    prevFilters.source !== source
  ) {
    setPrevFilters({ search, category, source });
    setVisibleCount(PURCHASE_HISTORY_PAGE_SIZE);
  }

  const visible = getVisiblePurchases(filtered, visibleCount);
  const hasMore = visibleCount < filtered.length;
  const hasActiveFilters = search.trim() !== "" || category !== "" || source !== "all";

  return (
    <div>
      <div className="flex items-center gap-2">
        <ShoppingBag className="h-5 w-5 text-sky-300" />
        <h2 className="text-lg font-semibold text-white">Purchase History</h2>
      </div>

      <div className="mt-4 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by merchant…"
            aria-label="Search purchases by merchant"
            className="fb-input pl-9"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filter by category"
            className="fb-input"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="Filter by source"
            className="fb-input"
          >
            <option value="all">All sources</option>
            <option value="receipt">Receipt</option>
            <option value="statement">Statement</option>
          </select>
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        {filtered.length} {filtered.length === 1 ? "purchase" : "purchases"}
        {hasActiveFilters ? " found" : ""}
      </p>

      {filtered.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-6 text-center">
          <p className="font-medium text-white">No purchases found</p>
          <p className="mt-2 text-sm text-slate-400">
            Try adjusting your search or filters.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {visible.map((purchase) => (
            <Link
              key={purchase.id}
              href={`/purchases/${purchase.id}`}
              className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/60 p-4 transition hover:border-white/20 hover:bg-slate-950/80"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-white">
                  {purchase.merchant ?? "Unknown merchant"}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {formatDate(purchase.date)} ·{" "}
                  <span className="capitalize">{purchase.source}</span>
                  {purchase.category ? (
                    <>
                      {" "}
                      · <span>{purchase.category}</span>
                    </>
                  ) : null}
                </p>
              </div>
              <p className="ml-4 shrink-0 text-sm font-semibold text-white">
                {purchase.amount !== null &&
                purchase.amount !== undefined &&
                !Number.isNaN(purchase.amount)
                  ? formatCurrency(purchase.amount, purchase.currency)
                  : "—"}
              </p>
            </Link>
          ))}

          {hasMore ? (
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + PURCHASE_HISTORY_PAGE_SIZE)}
              className="fb-btn-secondary w-full"
            >
              Show more
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}