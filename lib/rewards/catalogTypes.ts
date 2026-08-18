/**
 * Card product catalog types.
 *
 * These types represent the shared, non-user-owned catalog of reward programs,
 * card products, and their earning rules. They align with the deployed schema
 * from the Card Product Catalog migration.
 *
 * Eligibility status is intentionally NOT defined here. Eligibility remains an
 * evaluation result produced by applying a rule to a specific Purchase.
 */

import type { CardNetwork, RewardCurrency } from "@/lib/wallet/types";
import type { CanonicalCategoryKey } from "./categories";

/** Source/provenance of a catalog record. */
export type CardProductSource =
  | "issuer_website"
  | "issuer_disclosure"
  | "manual_research"
  | "development_fixture"
  | "unknown";

/** A reward program / points/miles/cashback ecosystem. */
export interface RewardProgram {
  /** Stable program identifier. */
  id: string;

  /** Program name, e.g. "Chase Ultimate Rewards". */
  name: string;

  /** Reward currency. */
  currency: RewardCurrency;

  /** Program family. */
  family:
    | "cashback"
    | "bank_points"
    | "airline_miles"
    | "hotel_points"
    | "other";

  /** Authoritative source. */
  source: CardProductSource;

  /** ISO timestamp when this record was last verified. */
  lastVerifiedAt: string | null;

  /** Additional structured metadata. */
  metadata: Record<string, unknown> | null;
}

/** A shared credit-card product definition. */
export interface CardProduct {
  /** Stable product identifier. */
  id: string;

  /** Reward program this product participates in. */
  rewardProgramId: string | null;

  /** Issuing bank or institution. */
  issuer: string;

  /** Official product name. */
  name: string;

  /** Card network. */
  network: CardNetwork;

  /** Whether the product is currently offered/marketed. */
  active: boolean;

  /** Annual fee in the product's home currency, if known. */
  annualFee: number | null;

  /** Authoritative source. */
  source: CardProductSource;

  /** ISO timestamp when this record was last verified. */
  lastVerifiedAt: string | null;

  /** Additional structured metadata. */
  metadata: Record<string, unknown> | null;
}

/**
 * A product-level, non-earning benefit/perk/credit definition.
 *
 * Distinction (per the approved Card Product Catalog design):
 * - EarningRule  = how a product earns transaction-level rewards.
 * - ProductBenefit = a perk/credit/protection that does not produce
 *   transaction-level rewards (e.g. statement credit, lounge access).
 *
 * This is the shared, non-user-owned definition. User-specific usage state
 * (activation, remaining value, expiry) lives separately in
 * `lib/wallet` as `WalletBenefit` and references this by `productBenefitId`.
 */
export interface ProductBenefit {
  /** Stable benefit identifier. */
  id: string;

  /** The card product this benefit belongs to. */
  cardProductId: string;

  /** Benefit classification. */
  type:
    | "statement_credit"
    | "travel_credit"
    | "lounge_access"
    | "purchase_protection"
    | "extended_warranty"
    | "trip_delay"
    | "free_checked_bag"
    | "hotel_status"
    | "other";

  /** Short title. */
  title: string;

  /** Longer description. */
  description: string | null;

  /** Category this benefit relates to, if any. */
  eligibleCategory: string | null;

  /** Merchant this benefit relates to, if any. */
  eligibleMerchant: string | null;

  /** Fixed dollar value, when applicable. */
  fixedValue: number | null;

  /** Annual limit or cap, when applicable. */
  annualLimit: number | null;

  /** Whether activation is required. */
  requiresActivation: boolean;

  /** Authoritative source. */
  source: CardProductSource;

  /** ISO timestamp when this record was last verified. */
  lastVerifiedAt: string | null;

  /** Whether the benefit is currently active at the product level. */
  active: boolean;
}

/** A rule describing how a card product earns rewards for eligible transactions. */
export interface EarningRule {
  /** Stable rule identifier. */
  id: string;

  /** The card product this rule applies to. */
  cardProductId: string;

  /** Rule structure. */
  type: "earning_rate" | "statement_credit" | "offer";

  /** Canonical category this rule applies to, if category-based. */
  eligibleCategory: CanonicalCategoryKey | null;

  /** Specific merchant pattern this rule applies to, if merchant-specific. */
  eligibleMerchant: string | null;

  /** Merchants explicitly excluded from this rule. */
  excludedMerchants: string[];

  /** Reward currency. */
  rewardCurrency: RewardCurrency;

  /** Base reward value (e.g. points per dollar or earn-rate basis). */
  rewardValue: number;

  /** Percentage rate, when applicable (e.g. 3 for 3%). */
  percentage: number | null;

  /** Fixed credit/offer value, when applicable. */
  fixedValue: number | null;

  /** Human-readable explanation. */
  explanation: string;

  /** Authoritative source. */
  source: CardProductSource;

  /** ISO timestamp when this record was last verified. */
  lastVerifiedAt: string | null;

  /** Whether the rule is currently active. */
  active: boolean;

  /** Additional structured metadata. */
  metadata: Record<string, unknown> | null;
}
