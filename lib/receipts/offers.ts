/**
 * Offer data model and deterministic matching for receipt line items.
 *
 * IMPORTANT: The offers in this module are DEVELOPMENT TEST DATA ONLY.
 * They are not real Chase Offers, are not user-specific, and do not exist
 * in production. Every offer is tagged `source: "development"` so it can
 * never be mistaken for a real offer.
 *
 * This module is intentionally NOT wired into the savings engine yet.
 */

import type { ReceiptItem } from "./types";

/** A single offer that can be matched against receipt line items. */
export interface ReceiptOffer {
  /** Stable identifier for the offer. */
  id: string;

  /** Short human-readable title. */
  title: string;

  /** Longer description of the offer. */
  description: string;

  /** Merchant the offer applies to, when merchant-specific. */
  merchant: string | null;

  /** Spending category the offer applies to, when category-specific. */
  category: string | null;

  /** Product keywords used to match line items (case-insensitive). */
  productKeywords: string[];

  /** How the discount is applied. */
  discountType: "percentage" | "fixed";

  /** The discount amount: a percentage (0-100) or a fixed dollar value. */
  discountValue: number;

  /** Maximum savings cap, when the offer has one. */
  maxSavings: number | null;

  /** Whether the offer is currently active. */
  active: boolean;

  /** Provenance. Always "development" for this test catalog. */
  source: "development";
}

/** A receipt line item matched to an offer, with estimated savings. */
export interface OfferMatch {
  /** The matched offer. */
  offer: ReceiptOffer;

  /** Names of the receipt items that matched this offer. */
  matchedItemNames: string[];

  /** Deterministic estimated savings for this match. */
  estimatedSavings: number;
}

/**
 * DEVELOPMENT TEST CATALOG.
 *
 * These offers are synthetic and used only to exercise the matching logic.
 * They are NOT real offers and must not be surfaced as real Chase Offers.
 */
export const DEVELOPMENT_TEST_OFFERS: ReceiptOffer[] = [
  {
    id: "dev-offer-coffee-10pct",
    title: "10% off coffee (dev test)",
    description:
      "DEVELOPMENT TEST OFFER — 10% off any coffee product. Not a real offer.",
    merchant: null,
    category: null,
    productKeywords: ["coffee"],
    discountType: "percentage",
    discountValue: 10,
    maxSavings: 5,
    active: true,
    source: "development",
  },
  {
    id: "dev-offer-pet-food-2",
    title: "$2 off pet food (dev test)",
    description:
      "DEVELOPMENT TEST OFFER — $2 off any pet food product. Not a real offer.",
    merchant: null,
    category: "Pet",
    productKeywords: ["dog food", "dry dog", "cat food", "kibble", "pet food"],
    discountType: "fixed",
    discountValue: 2,
    maxSavings: null,
    active: true,
    source: "development",
  },
  {
    id: "dev-offer-headphones-15pct",
    title: "15% off headphones (dev test)",
    description:
      "DEVELOPMENT TEST OFFER — 15% off any headphone product. Not a real offer.",
    merchant: null,
    category: "Electronics",
    productKeywords: ["headphone", "earbud", "airpod"],
    discountType: "percentage",
    discountValue: 15,
    maxSavings: 20,
    active: true,
    source: "development",
  },
  {
    id: "dev-offer-vitamins-3",
    title: "$3 off vitamins (dev test)",
    description:
      "DEVELOPMENT TEST OFFER — $3 off any vitamin product. Not a real offer.",
    merchant: null,
    category: "Health",
    productKeywords: ["vitamin", "supplement"],
    discountType: "fixed",
    discountValue: 3,
    maxSavings: null,
    active: true,
    source: "development",
  },
  {
    id: "dev-offer-inactive-detergent",
    title: "INACTIVE — $1 off detergent (dev test)",
    description:
      "DEVELOPMENT TEST OFFER — intentionally inactive to verify inactive offers are ignored.",
    merchant: null,
    category: "Household",
    productKeywords: ["detergent"],
    discountType: "fixed",
    discountValue: 1,
    maxSavings: null,
    active: false,
    source: "development",
  },
];

/** Lowercases a value for matching; tolerant of null/non-string input. */
function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

/**
 * Matches receipt line items against the development test offers.
 *
 * Rules:
 * - Case-insensitive matching against product names and categories.
 * - Inactive offers are ignored.
 * - When an offer has productKeywords, match by product name keywords ONLY.
 *   Category matching is used ONLY as a fallback when productKeywords is
 *   empty and offer.category is non-null. This prevents a narrowly targeted
 *   offer from matching an entire category.
 * - Estimated savings:
 *   - percentage offer = matched item total × (discountValue / 100)
 *   - fixed offer = discountValue, applied ONCE per offer match (not per
 *     matched item); repeatable fixed offers are not supported yet
 *   - capped at maxSavings when provided
 *   - never negative
 * - A match is only included when estimatedSavings > 0.
 */
export function matchReceiptItemsToOffers(items: ReceiptItem[]): OfferMatch[] {
  const matches: OfferMatch[] = [];

  for (const offer of DEVELOPMENT_TEST_OFFERS) {
    if (!offer.active) {
      continue;
    }

    const matchedItemNames: string[] = [];
    let estimatedSavings = 0;

    for (const item of items) {
      const name = normalize(item.name);
      const category = normalize(item.category);

      // Match by keywords when provided; otherwise fall back to exact
      // category matching (only when a category is set).
      let itemMatches = false;

      if (offer.productKeywords.length > 0) {
        itemMatches = offer.productKeywords.some((keyword) =>
          name.includes(normalize(keyword))
        );
      } else if (offer.category !== null) {
        itemMatches = category === normalize(offer.category);
      }

      if (!itemMatches) {
        continue;
      }

      matchedItemNames.push(item.name ?? "Unknown item");

      if (offer.discountType === "percentage") {
        const itemTotal = item.total ?? 0;
        const itemSavings = Math.max(0, itemTotal * (offer.discountValue / 100));
        estimatedSavings += itemSavings;
      }
      // Fixed offers are not per-item: the discount value is applied once
      // below, after the loop.
    }

    // Fixed offers apply once per offer match.
    if (offer.discountType === "fixed") {
      estimatedSavings = Math.max(0, offer.discountValue);
    }

    // Cap at maxSavings when provided.
    if (offer.maxSavings !== null) {
      estimatedSavings = Math.min(estimatedSavings, offer.maxSavings);
    }

    // Round to cents to avoid float noise.
    estimatedSavings = Math.round(estimatedSavings * 100) / 100;

    // Only include matches with positive savings.
    if (matchedItemNames.length > 0 && estimatedSavings > 0) {
      matches.push({
        offer,
        matchedItemNames,
        estimatedSavings,
      });
    }
  }

  return matches;
}