/**
 * Wallet data model — cards, benefits, and associated reward definitions.
 *
 * This is the foundation for the user's financial wallet. It contains no
 * live Chase data, no real user-specific benefits, and no external API
 * calls. All fixtures are tagged `source: "development"`.
 */

/** Card network for a wallet card. */
export type CardNetwork =
  | "visa"
  | "mastercard"
  | "amex"
  | "discover"
  | "other";

/** Classification of a card benefit. */
export type BenefitType =
  | "earning_rate"
  | "statement_credit"
  | "offer"
  | "purchase_protection"
  | "travel"
  | "other";

/** The currency in which a benefit or card earns. */
export type RewardCurrency = "cashback" | "points" | "miles" | "none";

/** A benefit associated with a specific card. */
export interface CardBenefit {
  /** Stable identifier for the benefit. */
  id: string;

  /** The id of the card this benefit belongs to. */
  cardId: string;

  /** Classification of the benefit. */
  type: BenefitType;

  /** Short human-readable title. */
  title: string;

  /** Longer explanation of the benefit. */
  description: string;

  /** Spending category the benefit applies to, when category-specific. */
  category: string | null;

  /** Merchant the benefit applies to, when merchant-specific. */
  merchant: string | null;

  /** The currency this benefit rewards (e.g. points, cashback, miles). */
  rewardCurrency: RewardCurrency;

  /** Base reward value (e.g. points per dollar, or earn rate basis). */
  rewardValue: number;

  /** Percentage, for percentage-based benefits (e.g. 3% earning). */
  percentage: number | null;

  /** Fixed dollar value, for fixed-value benefits (e.g. statement credit). */
  fixedValue: number | null;

  /** Maximum value per benefit period, when capped. */
  annualLimit: number | null;

  /** Remaining value available under the annualLimit, when tracked. */
  remainingLimit: number | null;

  /** Whether the benefit is currently active. */
  active: boolean;

  /** Provenance. Always "development" for dev fixtures. */
  source: "development";
}

/** A credit/debit card in the user's wallet. */
export interface WalletCard {
  /** Stable identifier for the card. */
  id: string;

  /** Display name of the card. */
  name: string;

  /** Issuing bank/institution. */
  issuer: string;

  /** Card network. */
  network: CardNetwork;

  /** The primary reward currency of the card. */
  rewardCurrency: RewardCurrency;

  /** Last four digits of the card number, when available. */
  lastFour: string | null;

  /** Whether the card is currently active. */
  active: boolean;

  /** Provenance. Always "development" for dev fixtures. */
  source: "development";
}

/** The user's wallet: held cards plus their associated benefits. */
export interface Wallet {
  /** Every card in the wallet. */
  cards: WalletCard[];

  /** Every benefit across all cards. */
  benefits: CardBenefit[];
}