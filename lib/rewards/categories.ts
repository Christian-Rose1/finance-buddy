/**
 * Canonical spending/rewards category taxonomy.
 *
 * Spending categories and rewards eligibility are separate concerns. This
 * module defines the canonical two-level spending taxonomy, stable keys for
 * rewards rules to reference, and a compatibility mapping from legacy flat
 * category strings. It does not contain any reward rules, matching logic, or
 * card-specific exclusions.
 */

// =============================================================================
// Canonical leaf keys
// =============================================================================

/** Canonical spending category leaf keys (root:leaf or root-only). */
export type CanonicalCategoryKey =
  // Food
  | "food"
  | "food:groceries"
  | "food:dining"
  | "food:coffee"
  | "food:delivery"
  | "food:alcohol"
  // Travel
  | "travel"
  | "travel:airfare"
  | "travel:hotels"
  | "travel:rental_cars"
  | "travel:other_travel"
  // Transportation
  | "transportation"
  | "transportation:transit"
  | "transportation:rideshare"
  | "transportation:gas"
  | "transportation:ev_charging"
  | "transportation:parking"
  | "transportation:tolls"
  // Shopping
  | "shopping"
  | "shopping:clothing"
  | "shopping:electronics"
  | "shopping:general_merchandise"
  | "shopping:online_retail"
  | "shopping:gifts"
  // Home
  | "home"
  | "home:home_improvement"
  | "home:household"
  | "home:services"
  | "home:furnishings"
  // Bills
  | "bills"
  | "bills:utilities"
  | "bills:internet"
  | "bills:phone"
  | "bills:insurance"
  | "bills:subscriptions"
  | "bills:streaming"
  // Health
  | "health"
  | "health:pharmacy"
  | "health:medical"
  | "health:dental"
  | "health:vision"
  | "health:fitness"
  // Entertainment
  | "entertainment"
  | "entertainment:streaming"
  | "entertainment:events"
  | "entertainment:gaming"
  | "entertainment:hobbies"
  // Personal care
  | "personal_care"
  | "personal_care:grooming"
  | "personal_care:cosmetics"
  | "personal_care:spa"
  // Pet
  | "pet"
  | "pet:pet_food"
  | "pet:pet_supplies"
  | "pet:veterinary"
  // Education
  | "education"
  | "education:tuition"
  | "education:books"
  | "education:courses"
  // Business
  | "business"
  // Other (explicitly classified as Other, not unknown)
  | "other";

// =============================================================================
// Roots and leaves
// =============================================================================

export interface CanonicalRoot {
  /** Stable root key. */
  key: string;

  /** Human-readable display label. */
  label: string;

  /** Leaf keys under this root, including the root key itself as a wildcard. */
  leaves: readonly CanonicalCategoryKey[];
}

export const CANONICAL_ROOTS: readonly CanonicalRoot[] = [
  {
    key: "food",
    label: "Food",
    leaves: [
      "food",
      "food:groceries",
      "food:dining",
      "food:coffee",
      "food:delivery",
      "food:alcohol",
    ],
  },
  {
    key: "travel",
    label: "Travel",
    leaves: [
      "travel",
      "travel:airfare",
      "travel:hotels",
      "travel:rental_cars",
      "travel:other_travel",
    ],
  },
  {
    key: "transportation",
    label: "Transportation",
    leaves: [
      "transportation",
      "transportation:transit",
      "transportation:rideshare",
      "transportation:gas",
      "transportation:ev_charging",
      "transportation:parking",
      "transportation:tolls",
    ],
  },
  {
    key: "shopping",
    label: "Shopping",
    leaves: [
      "shopping",
      "shopping:clothing",
      "shopping:electronics",
      "shopping:general_merchandise",
      "shopping:online_retail",
      "shopping:gifts",
    ],
  },
  {
    key: "home",
    label: "Home",
    leaves: [
      "home",
      "home:home_improvement",
      "home:household",
      "home:services",
      "home:furnishings",
    ],
  },
  {
    key: "bills",
    label: "Bills & Subscriptions",
    leaves: [
      "bills",
      "bills:utilities",
      "bills:internet",
      "bills:phone",
      "bills:insurance",
      "bills:subscriptions",
      "bills:streaming",
    ],
  },
  {
    key: "health",
    label: "Health",
    leaves: [
      "health",
      "health:pharmacy",
      "health:medical",
      "health:dental",
      "health:vision",
      "health:fitness",
    ],
  },
  {
    key: "entertainment",
    label: "Entertainment",
    leaves: [
      "entertainment",
      "entertainment:streaming",
      "entertainment:events",
      "entertainment:gaming",
      "entertainment:hobbies",
    ],
  },
  {
    key: "personal_care",
    label: "Personal Care",
    leaves: [
      "personal_care",
      "personal_care:grooming",
      "personal_care:cosmetics",
      "personal_care:spa",
    ],
  },
  {
    key: "pet",
    label: "Pet",
    leaves: ["pet", "pet:pet_food", "pet:pet_supplies", "pet:veterinary"],
  },
  {
    key: "education",
    label: "Education",
    leaves: ["education", "education:tuition", "education:books", "education:courses"],
  },
  {
    key: "business",
    label: "Business",
    leaves: ["business"],
  },
  {
    key: "other",
    label: "Other",
    leaves: ["other"],
  },
] as const;

/** All canonical category keys flattened for fast membership checks. */
export const ALL_CANONICAL_CATEGORY_KEYS: Set<CanonicalCategoryKey> = new Set(
  CANONICAL_ROOTS.flatMap((root) => root.leaves)
);

// =============================================================================
// Legacy-to-canonical mapping
// =============================================================================

/**
 * Mapping from legacy flat category strings (produced by the current receipt
 * categorizer and Chase parser) to canonical category keys.
 *
 * Unknown legacy values are NOT mapped. `normalizeCategory()` returns null for
 * unrecognized input so callers can distinguish "explicitly Other" from
 * "unknown/unclassified".
 */
export const LEGACY_TO_CANONICAL: Readonly<Record<string, CanonicalCategoryKey>> = {
  // Receipt categorizer legacy values
  Groceries: "food:groceries",
  Dining: "food:dining",
  Household: "home:household",
  "Personal Care": "personal_care:grooming",
  Pet: "pet:pet_supplies",
  Electronics: "shopping:electronics",
  Clothing: "shopping:clothing",
  Health: "health:pharmacy",
  Entertainment: "entertainment",
  Travel: "travel",
  Other: "other",

  // Chase parser / statement legacy values
  "Travel / Transportation": "transportation",
  "Bills & Subscriptions": "bills",
  "Home / Services": "home",
  Shopping: "shopping",
};

// =============================================================================
// Helpers
// =============================================================================

/** Normalizes a string for comparison: trim, collapse whitespace, lowercase. */
function normalizeString(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Convert a legacy flat category or canonical key into a canonical category
 * key.
 *
 * Behavior:
 * - Known legacy flat values → canonical key
 * - Already-canonical keys → returned unchanged
 * - Null, undefined, empty, or unknown values → null
 *
 * `other` is returned only when the input is explicitly "Other" or already
 * canonical `other`. Unknown/unrecognized input returns null.
 */
export function normalizeCategory(
  value: string | null | undefined
): CanonicalCategoryKey | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Already canonical?
  if (ALL_CANONICAL_CATEGORY_KEYS.has(trimmed as CanonicalCategoryKey)) {
    return trimmed as CanonicalCategoryKey;
  }

  // Legacy mapping lookup is case-insensitive and whitespace-tolerant.
  const normalized = normalizeString(trimmed);
  for (const [legacyKey, canonicalKey] of Object.entries(LEGACY_TO_CANONICAL)) {
    if (normalizeString(legacyKey) === normalized) {
      return canonicalKey;
    }
  }

  // Unknown/unrecognized.
  return null;
}

/**
 * Parse a canonical category key into its root and optional leaf.
 *
 * Returns null for null/empty input. Returns `{ root: key, leaf: null }` for
 * root-only keys. Returns `{ root, leaf }` for leaf keys.
 */
export function parseCanonicalCategory(
  key: CanonicalCategoryKey | string | null | undefined
): { root: CanonicalCategoryKey | string; leaf: string | null } | null {
  if (key === null || key === undefined) {
    return null;
  }

  const trimmed = key.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parts = trimmed.split(":");
  const root = parts[0];
  const leaf = parts.length > 1 ? parts.slice(1).join(":") : null;

  return { root, leaf };
}

/**
 * Returns true when `key` belongs to the given `root`, including root-only
 * keys. Comparison is case-sensitive because canonical keys are stable,
 * lowercase, snake_case values.
 *
 * Examples:
 * - isLeafOf("food:groceries", "food") → true
 * - isLeafOf("food", "food") → true
 * - isLeafOf("food:dining", "travel") → false
 */
export function isLeafOf(
  key: CanonicalCategoryKey | string | null | undefined,
  root: CanonicalCategoryKey | string
): boolean {
  const parsed = parseCanonicalCategory(key);
  if (parsed === null) {
    return false;
  }
  return parsed.root === root;
}
