/**
 * Customer-visible text policy shared by provider-output validation and the
 * customer-safe presentation projection.
 *
 * This filter handles SYNTAX and PRIVACY only: opaque internal references
 * (award-1, card-1, cash-1, source-1, scenario-3, ...), URLs where URLs are
 * prohibited, and genuine technical pipeline terms that cannot be
 * customer-facing (payload, signature, validation, provider, stage).
 *
 * It deliberately does NOT discard a sentence merely because it contains
 * ordinary semantic words such as "live", "bookable", "guaranteed", or
 * "exact". Those words can appear in important negative or cautionary
 * statements ("No live availability was verified.", "Exact dates were not
 * confirmed.", "This planning estimate is not bookable."). Unsupported
 * positive claims are controlled by the deterministic evidence gate and by
 * future claim-level authorization — never by a growing keyword blacklist.
 */

/**
 * Prefixes used by every opaque reference syntax the pipeline produces:
 * award-N, card-N, cash-N, source-N, option-N, scenario-N, action-N,
 * alternative-N, allocation-N, research-N, request-N, offer-N, trip-shape-N,
 * flight-estimate-N, hotel-estimate-N, plus the legacy
 * source/account/goal/user/program/run-N syntaxes.
 *
 * This pattern is applied only to model-authored prose and external labels.
 * It is never applied to projection-generated display keys (for example
 * `flight-estimate-1` on a customer-safe estimate card), which are created
 * by the projection itself and are not internal references.
 */
const CUSTOMER_INTERNAL_REFERENCE_PREFIXES =
  "award|card|cash|option|scenario|action|alternative|allocation|research|request|offer|trip[-_]?shape|flight[-_]?estimate|hotel[-_]?estimate|source|account|goal|user|program|run";

/** Any opaque internal reference that must never reach customer-visible prose. */
export const CUSTOMER_INTERNAL_REFERENCE_PATTERN = new RegExp(
  `\\b(?:${CUSTOMER_INTERNAL_REFERENCE_PREFIXES})[-_][A-Za-z0-9_-]+\\b`,
  "i",
);

export function containsCustomerInternalReference(text: string): boolean {
  return CUSTOMER_INTERNAL_REFERENCE_PATTERN.test(text);
}

/**
 * A sentence is unsafe for customers when it carries a URL, an internal
 * reference, or a genuine technical pipeline term. Ordinary semantic words
 * are not in this pattern: claim truth is the evidence gate's job.
 */
const CUSTOMER_UNSAFE_SENTENCE_PATTERN = new RegExp(
  `(?:https?:\\/\\/|www\\.|\\b(?:${CUSTOMER_INTERNAL_REFERENCE_PREFIXES})[-_][A-Za-z0-9_-]+\\b|\\b(?:payload|signature|validation|provider|stage)\\b)`,
  "i",
);

/**
 * Remove complete unsafe sentences from customer-visible text. Sentences are
 * dropped whole (never fragmented); remaining sentences are joined with a
 * single space. Returns "" when every sentence is unsafe.
 */
export function filterCustomerSentences(text: string): string {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(
      (sentence) =>
        sentence && !CUSTOMER_UNSAFE_SENTENCE_PATTERN.test(sentence),
    );
  return sentences.join(" ").replace(/\s+/g, " ").trim();
}
