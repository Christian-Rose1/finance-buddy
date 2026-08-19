/**
 * Focused tests for the minimal Confirmation & Evidence layer (F1).
 *
 * Run: npx tsx --test lib/purchases/confirmation.test.ts
 *
 * Pins the "do not guess" contract: exactly one active card with a matching
 * last-four → confirmed; zero matches → null; multiple active-card matches →
 * null. Inactive cards never participate.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  confirmCardUsed,
  confirmationCardId,
  cardUsedProvenance,
} from "./confirmation";

type ActiveCard = { id: string; lastFour: string | null };

function makeCard(overrides: Partial<ActiveCard> = {}): ActiveCard {
  return { id: "card-1", lastFour: "1234", ...overrides };
}

describe("confirmCardUsed", () => {
  it("exactly one active card last-four match → cardId populated", () => {
    const activeCards: ActiveCard[] = [
      makeCard({ id: "card-1", lastFour: "1234" }),
      makeCard({ id: "card-2", lastFour: "5678" }),
    ];

    // A genuine card last-four (card-specific evidence).
    const confirmation = confirmCardUsed("1234", activeCards);

    assert.ok(confirmation !== null);
    assert.equal(confirmation.fact, "card_used");
    assert.equal(confirmation.value, "card-1");
    assert.equal(confirmation.origin, "evidence");
    assert.equal(confirmation.verified, false);
    assert.match(confirmation.reason, /1234/);
    assert.match(confirmation.reason, /Card last-four/);
    assert.equal(confirmationCardId(confirmation), "card-1");
  });

  it("a statement ACCOUNT number is never treated as a card last-four", () => {
    // Real-world case: Chase statement account ends in 8812; the user's
    // active Sapphire Preferred card ends in 1234. These are different
    // identifiers. Passing the account number must NOT match the card, and
    // must never guess or fall back on the card by name.
    const activeCards: ActiveCard[] = [
      { id: "card-1", lastFour: "1234" },
    ];

    const confirmation = confirmCardUsed("8812", activeCards);

    assert.equal(confirmation, null);
    assert.equal(confirmationCardId(confirmation), null);
  });

  it("no match → null (do not guess)", () => {
    const activeCards: ActiveCard[] = [
      makeCard({ id: "card-1", lastFour: "1234" }),
      makeCard({ id: "card-2", lastFour: "5678" }),
    ];

    const confirmation = confirmCardUsed("9999", activeCards);

    assert.equal(confirmation, null);
    assert.equal(confirmationCardId(confirmation), null);
  });

  it("multiple active last-four matches → null (ambiguous, do not guess)", () => {
    // Two distinct active cards share the same last-four → ambiguous.
    const activeCards: ActiveCard[] = [
      makeCard({ id: "card-1", lastFour: "1234" }),
      makeCard({ id: "card-2", lastFour: "1234" }),
    ];

    const confirmation = confirmCardUsed("1234", activeCards);

    assert.equal(confirmation, null);
  });

  it("matches the single candidate the caller provided (active filtering is caller's job)", () => {
    // `confirmCardUsed` operates on the already-active-card list; the route
    // filters to ACTIVE wallet cards before calling. Here we pass only the
    // active candidate and it must match.
    const confirmation = confirmCardUsed("1234", [
      makeCard({ id: "card-1", lastFour: "1234" }),
    ]);

    assert.ok(confirmation !== null);
    assert.equal(confirmation.value, "card-1");
  });

  it("zero active cards → null", () => {
    const confirmation = confirmCardUsed("1234", []);

    assert.equal(confirmation, null);
  });

  it("lastFour stored as null on a card never matches", () => {
    const activeCards: ActiveCard[] = [makeCard({ id: "card-1", lastFour: null })];

    const confirmation = confirmCardUsed("1234", activeCards);

    assert.equal(confirmation, null);
  });
});

describe("cardUsedProvenance", () => {
  it("builds evidence-backed, unverified provenance for cardId", () => {
    const confirmation = confirmCardUsed("1234", [
      makeCard({ id: "card-1", lastFour: "1234" }),
    ])!;

    const provenance = cardUsedProvenance(confirmation, "evidence-1");

    assert.equal(provenance.field, "cardId");
    assert.equal(provenance.origin, "evidence");
    assert.deepEqual(provenance.evidenceIds, ["evidence-1"]);
    assert.equal(provenance.verificationStatus, "unverified");
    assert.equal(provenance.method, confirmation.reason);
  });
});