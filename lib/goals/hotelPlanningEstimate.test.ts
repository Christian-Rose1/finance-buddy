import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL,
  HOTEL_PLANNING_ESTIMATE_EVIDENCE_LABEL,
  HOTEL_PLANNING_ESTIMATE_LABEL,
  HOTEL_PLANNING_ESTIMATE_VERIFICATION_LABEL,
  parseDisplayedPrice,
  projectHotelPlanningEstimate,
  projectSerpApiHotelEstimate,
} from "./hotelPlanningEstimate";
import { buildStrategyRunStagePayload, validateStrategyRunStagePayload } from "./strategyRunPayload";
import type { InterpretedResearch } from "./researchInterpreter";

function validOptionInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "option-1",
    propertyName: "Example Grand Hotel",
    locationText: "Copenhagen",
    nightlyPrice: 1200,
    nightlyPriceCurrency: "USD",
    totalPrice: 9600,
    totalPriceCurrency: "USD",
    rating: 4.5,
    reviewCount: 812,
    hotelClass: 4,
    neighborhood: "Vesterbro",
    amenities: ["Free Wi-Fi", "Breakfast included"],
    propertyUrl: "https://example.com/property",
    imageUrl: "https://example.com/image.jpg",
    trustStatus: "search_estimate",
    ...overrides,
  };
}

function validEstimateInput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    label: HOTEL_PLANNING_ESTIMATE_LABEL,
    destination: "Copenhagen",
    checkInDate: "2027-04-03",
    checkOutDate: "2027-04-11",
    nights: 8,
    travelers: 2,
    currency: "USD",
    options: [validOptionInput()],
    disclosure: HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL,
    evidenceLabel: HOTEL_PLANNING_ESTIMATE_EVIDENCE_LABEL,
    verificationLabel: HOTEL_PLANNING_ESTIMATE_VERIFICATION_LABEL,
    availabilityLabel: HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL,
    ...overrides,
  };
}

function interpretedEnvelope(hotelPlanningEstimate?: unknown) {
  return {
    awardOptions: [],
    cardOffers: [],
    sources: [],
    assumptions: [],
    warnings: [],
    ...(hotelPlanningEstimate === undefined ? {} : { hotelPlanningEstimate }),
  } as unknown as InterpretedResearch;
}

test("accepts a complete valid estimate and returns a fresh projected object", () => {
  const input = validEstimateInput();
  const projected = projectHotelPlanningEstimate(input);
  assert.ok(projected);
  assert.notStrictEqual(projected, input);
  assert.notStrictEqual(projected.options, input.options);
  assert.notStrictEqual(projected.options[0], input.options[0]);
  assert.equal(projected.schemaVersion, 1);
  assert.equal(projected.destination, "Copenhagen");
  assert.equal(projected.checkInDate, "2027-04-03");
  assert.equal(projected.checkOutDate, "2027-04-11");
  assert.equal(projected.nights, 8);
  assert.equal(projected.travelers, 2);
  assert.equal(projected.currency, "USD");
  assert.equal(projected.options.length, 1);
  assert.deepEqual(projected.options[0].amenities, ["Free Wi-Fi", "Breakfast included"]);
});

test("accepts legitimate nullable optional fields", () => {
  const projected = projectHotelPlanningEstimate(validEstimateInput({
    options: [validOptionInput({
      locationText: null,
      rating: null,
      reviewCount: null,
      hotelClass: null,
      neighborhood: null,
      amenities: [],
      propertyUrl: null,
      imageUrl: null,
      nightlyPrice: null,
      nightlyPriceCurrency: null,
      totalPrice: null,
      totalPriceCurrency: null,
      trustStatus: "price_unavailable",
    })],
  }));
  assert.ok(projected);
  const option = projected.options[0];
  assert.equal(option.locationText, null);
  assert.equal(option.rating, null);
  assert.equal(option.reviewCount, null);
  assert.equal(option.hotelClass, null);
  assert.equal(option.neighborhood, null);
  assert.deepEqual(option.amenities, []);
  assert.equal(option.propertyUrl, null);
  assert.equal(option.imageUrl, null);
  assert.equal(option.nightlyPrice, null);
  assert.equal(option.nightlyPriceCurrency, null);
  assert.equal(option.totalPrice, null);
  assert.equal(option.totalPriceCurrency, null);
  assert.equal(option.trustStatus, "price_unavailable");
});

test("keeps nightly and whole-stay prices distinct and never derives one from the other", () => {
  // Nightly-only: total must stay null (no multiplication).
  const nightlyOnly = projectHotelPlanningEstimate(validEstimateInput({
    options: [validOptionInput({ totalPrice: null, totalPriceCurrency: null })],
  }));
  assert.ok(nightlyOnly);
  assert.equal(nightlyOnly.options[0].nightlyPrice, 1200);
  assert.equal(nightlyOnly.options[0].nightlyPriceCurrency, "USD");
  assert.equal(nightlyOnly.options[0].totalPrice, null);
  assert.equal(nightlyOnly.options[0].totalPriceCurrency, null);

  // Total-only: nightly must stay null (no division).
  const totalOnly = projectHotelPlanningEstimate(validEstimateInput({
    options: [validOptionInput({ nightlyPrice: null, nightlyPriceCurrency: null })],
  }));
  assert.ok(totalOnly);
  assert.equal(totalOnly.options[0].totalPrice, 9600);
  assert.equal(totalOnly.options[0].totalPriceCurrency, "USD");
  assert.equal(totalOnly.options[0].nightlyPrice, null);
  assert.equal(totalOnly.options[0].nightlyPriceCurrency, null);

  // Mixed currencies are preserved independently, never merged.
  const mixed = projectHotelPlanningEstimate(validEstimateInput({
    options: [validOptionInput({ totalPriceCurrency: "EUR" })],
  }));
  assert.ok(mixed);
  assert.equal(mixed.options[0].nightlyPriceCurrency, "USD");
  assert.equal(mixed.options[0].totalPriceCurrency, "EUR");
});

test("rejects malformed dates, currency, travelers, nights, prices, ratings, URLs, and empty options", () => {
  const badInputs: Array<Record<string, unknown>> = [
    validEstimateInput({ checkInDate: "2027-13-01" }),
    validEstimateInput({ checkOutDate: "not-a-date" }),
    validEstimateInput({ checkOutDate: "2027-04-03" }), // same as check-in
    validEstimateInput({ nights: 7 }), // mismatch with dates
    validEstimateInput({ nights: 0 }),
    validEstimateInput({ nights: 61 }),
    validEstimateInput({ currency: "usd" }),
    validEstimateInput({ currency: "DOLLAR" }),
    validEstimateInput({ travelers: 0 }),
    validEstimateInput({ travelers: 10 }),
    validEstimateInput({ travelers: 2.5 }),
    validEstimateInput({ options: [] }),
    validEstimateInput({ options: [validOptionInput({ nightlyPrice: 0 })] }),
    validEstimateInput({ options: [validOptionInput({ nightlyPrice: -1 })] }),
    validEstimateInput({ options: [validOptionInput({ nightlyPrice: 1_000_001 })] }),
    validEstimateInput({ options: [validOptionInput({ totalPrice: 0 })] }),
    validEstimateInput({ options: [validOptionInput({ rating: 0 })] }),
    validEstimateInput({ options: [validOptionInput({ rating: 5.5 })] }),
    validEstimateInput({ options: [validOptionInput({ reviewCount: 0 })] }),
    validEstimateInput({ options: [validOptionInput({ hotelClass: 0 })] }),
    validEstimateInput({ options: [validOptionInput({ hotelClass: 6 })] }),
    validEstimateInput({ options: [validOptionInput({ propertyUrl: "javascript:alert(1)" })] }),
    validEstimateInput({ options: [validOptionInput({ imageUrl: "http://example.com/insecure" })] }),
    validEstimateInput({ options: [validOptionInput({ propertyName: "" })] }),
    validEstimateInput({ options: [validOptionInput({ id: "" })] }),
    validEstimateInput({ schemaVersion: 2 }),
    validEstimateInput({ label: "Wrong label" }),
    validEstimateInput({ disclosure: "Not the fixed disclosure" }),
    validEstimateInput({ destination: "" }),
  ];
  for (const bad of badInputs) {
    assert.equal(projectHotelPlanningEstimate(bad), null, JSON.stringify(bad).slice(0, 80));
  }
});

test("rejects unsafe URL shapes while preserving safe property and image URLs", () => {
  const unsafeUrls = [
    "https://example.com/../etc",
    "https://example.com/%2e%2e/etc",
    "https://example.com/%2E%2E/etc",
    "https://example.com/a/./b",
    "https://example.com/%2e/etc",
    "https://example.com/%2E/etc",
    "https://example.com:99999/",
    "https://example.com:0/",
    "https://user:pass@example.com/",
    "https://example.com/path?query=1",
    "https://example.com/path#frag",
    "ftp://example.com/file",
    "HTTPS://EXAMPLE.COM/OK", // scheme is matched case-sensitively as https
    "https://example.com/\u0007", // control character
    "//example.com/no-scheme",
    // Encoded traversal/separator/control shapes that decode into hostile paths.
    "https://example.com/..%2fetc",
    "https://example.com/..%2Fetc",
    "https://example.com/.%2e/etc",
    "https://example.com/%2e./etc",
    "https://example.com/..%5cetc",
    "https://example.com/%252e%252e/etc",
    "https://example.com/a/%2e%2E/b",
    "https://example.com/%00",
    "https://example.com/%1f",
    "https://example.com/%7f",
    "https://example.com/%ZZ", // malformed percent escape
  ];
  for (const url of unsafeUrls) {
    assert.equal(
      projectHotelPlanningEstimate(validEstimateInput({ options: [validOptionInput({ propertyUrl: url })] })),
      null,
      JSON.stringify(url),
    );
  }
  // Ordinary safe HTTPS property and image URLs survive projection unchanged.
  const safe = projectHotelPlanningEstimate(validEstimateInput());
  assert.ok(safe);
  assert.equal(safe.options[0].propertyUrl, "https://example.com/property");
  assert.equal(safe.options[0].imageUrl, "https://example.com/image.jpg");
  // Safe encoded path content survives byte-exact: spaces, valid UTF-8
  // encoding, and ordinary filenames with dots are never rejected.
  for (const encodedUrl of [
    "https://example.com/Hotel%20Name",
    "https://example.com/H%C3%B4tel",
    "https://example.com/photo.jpg",
  ]) {
    const projected = projectHotelPlanningEstimate(
      validEstimateInput({ options: [validOptionInput({ propertyUrl: encodedUrl })] }),
    );
    assert.ok(projected, encodedUrl);
    assert.equal(projected.options[0].propertyUrl, encodedUrl);
  }
});

test("enforces rating, hotel-class, and review-count boundaries without mutating the input", () => {
  const accepted = [
    { rating: 5 },
    { hotelClass: 1 },
    { hotelClass: 5 },
    { reviewCount: 1 },
    { reviewCount: 10_000_000 },
  ];
  for (const overrides of accepted) {
    assert.ok(
      projectHotelPlanningEstimate(validEstimateInput({ options: [validOptionInput(overrides)] })),
      JSON.stringify(overrides),
    );
  }
  const rejected = [
    { rating: 0 },
    { rating: -1 },
    { rating: 5.5 },
    { rating: "4.5" },
    { hotelClass: 0 },
    { hotelClass: 6 },
    { hotelClass: "4" },
    { reviewCount: 0 },
    { reviewCount: 10_000_001 },
    { reviewCount: 2.5 },
  ];
  for (const overrides of rejected) {
    assert.equal(
      projectHotelPlanningEstimate(validEstimateInput({ options: [validOptionInput(overrides)] })),
      null,
      JSON.stringify(overrides),
    );
  }
  // Projection never mutates the untrusted input.
  const input = validEstimateInput();
  const snapshot = JSON.parse(JSON.stringify(input));
  projectHotelPlanningEstimate(input);
  assert.deepEqual(input, snapshot);
});

test("rejects unknown keys at both levels and mismatched price/currency pairing", () => {
  assert.equal(projectHotelPlanningEstimate({ ...validEstimateInput(), extra: "bad" }), null);
  assert.equal(
    projectHotelPlanningEstimate(validEstimateInput({ options: [{ ...validOptionInput(), extraField: "bad" }] })),
    null,
  );
  // Price without currency, or currency without price, is rejected.
  assert.equal(
    projectHotelPlanningEstimate(validEstimateInput({ options: [validOptionInput({ nightlyPriceCurrency: null })] })),
    null,
  );
  assert.equal(
    projectHotelPlanningEstimate(validEstimateInput({ options: [validOptionInput({ nightlyPrice: null })] })),
    null,
  );
  assert.equal(
    projectHotelPlanningEstimate(validEstimateInput({ options: [validOptionInput({ totalPriceCurrency: null })] })),
    null,
  );
  assert.equal(
    projectHotelPlanningEstimate(validEstimateInput({ options: [validOptionInput({ totalPrice: null })] })),
    null,
  );
});

test("preserves deterministic option and amenity order and deduplicates amenities", () => {
  const projected = projectHotelPlanningEstimate(validEstimateInput({
    options: [
      validOptionInput({ id: "option-b", propertyName: "B Hotel" }),
      validOptionInput({ id: "option-a", propertyName: "A Hotel" }),
    ],
  }));
  assert.ok(projected);
  assert.deepEqual(projected.options.map((option) => option.id), ["option-b", "option-a"]);
  const withDuplicates = projectHotelPlanningEstimate(validEstimateInput({
    options: [validOptionInput({ amenities: ["Spa", "Spa", "Gym", "Spa"] })],
  }));
  assert.ok(withDuplicates);
  assert.deepEqual(withDuplicates.options[0].amenities, ["Spa", "Gym"]);
});

test("contains no API key, raw provider response, query, or arbitrary metadata field", () => {
  const projected = projectHotelPlanningEstimate(validEstimateInput());
  assert.ok(projected);
  const serialized = JSON.stringify(projected).toLowerCase();
  for (const forbidden of ["api_key", "apikey", "serpapi", "search_id", "token", "signature", "raw_response", "metadata"]) {
    assert.equal(serialized.includes(forbidden), false, `projection must not contain ${forbidden}`);
  }
});

test("duplicate option IDs are rejected", () => {
  assert.equal(
    projectHotelPlanningEstimate(validEstimateInput({
      options: [validOptionInput({ id: "same" }), validOptionInput({ id: "same", propertyName: "Other" })],
    })),
    null,
  );
});

test("parseDisplayedPrice accepts complete unambiguous monetary strings", () => {
  assert.equal(parseDisplayedPrice("123"), 123);
  assert.equal(parseDisplayedPrice("123.45"), 123.45);
  assert.equal(parseDisplayedPrice("$123.45"), 123.45);
  assert.equal(parseDisplayedPrice("$1,234.56"), 1234.56);
  assert.equal(parseDisplayedPrice("$1,200"), 1200);
  assert.equal(parseDisplayedPrice("$89"), 89);
  assert.equal(parseDisplayedPrice("1,234.56 USD"), 1234.56);
  assert.equal(parseDisplayedPrice("1 234.56"), 1234.56);
  assert.equal(parseDisplayedPrice("1 234,56 €"), 1234.56);
  assert.equal(parseDisplayedPrice("1.234,56 €"), 1234.56);
  assert.equal(parseDisplayedPrice("1 234"), 1234);
  assert.equal(parseDisplayedPrice("999,999.99"), 999999.99);
  assert.equal(parseDisplayedPrice("USD 100"), 100);
  assert.equal(parseDisplayedPrice("100 USD"), 100);
});

test("parseDisplayedPrice rejects partial, hostile, and ambiguous strings", () => {
  const rejected = [
    "1,2,3", ".5", "1e6", "1e400", "12abc", "abc12", "$0.001", "1.23.4",
    "1,23,456", "--12", "", "$$", "$", "12,34,56", "1 23 456", "USD100",
    "$0", "$-5", "free", "US$89", null, 89, undefined, "$1,234.567",
    "1 234 567,89", ".", ",", "0,001",
  ];
  for (const value of rejected) {
    assert.equal(parseDisplayedPrice(value), null, JSON.stringify(value));
  }
});

function serpApiProperty(overrides: Record<string, unknown> = {}) {
  return {
    type: "hotel",
    name: "Example Grand Hotel",
    rate_per_night: { lowest: "$1,200", extracted_lowest: 1200 },
    total_rate: { lowest: "$9,600", extracted_lowest: 9600 },
    overall_rating: 4.5,
    reviews: 812,
    hotel_class: "4-star hotel",
    extracted_hotel_class: 4,
    amenities: ["Free Wi-Fi", "Breakfast included"],
    link: "https://example.com/property",
    images: [{ thumbnail: "https://example.com/image.jpg" }],
    ...overrides,
  };
}

function serpApiBody(overrides: Record<string, unknown> = {}) {
  return {
    search_metadata: { id: "raw-provider-search-id" },
    currency: "USD",
    properties: [serpApiProperty()],
    ...overrides,
  };
}

function serpApiInput(response: unknown, overrides: Record<string, unknown> = {}) {
  return {
    destination: "Copenhagen",
    checkInDate: "2027-04-03",
    checkOutDate: "2027-04-11",
    travelers: 2,
    currency: "USD",
    retrievedAt: "2027-01-02T03:04:05.000Z",
    response,
    ...overrides,
  };
}

test("projects a valid Google Hotels response deterministically from the documented shape", () => {
  const estimate = projectSerpApiHotelEstimate(serpApiInput(serpApiBody()));
  assert.ok(estimate);
  assert.equal(estimate.destination, "Copenhagen");
  assert.equal(estimate.checkInDate, "2027-04-03");
  assert.equal(estimate.checkOutDate, "2027-04-11");
  assert.equal(estimate.nights, 8);
  assert.equal(estimate.travelers, 2);
  assert.equal(estimate.currency, "USD");
  assert.equal(estimate.options.length, 1);
  const option = estimate.options[0];
  assert.equal(option.propertyName, "Example Grand Hotel");
  assert.equal(option.nightlyPrice, 1200);
  assert.equal(option.nightlyPriceCurrency, "USD");
  assert.equal(option.totalPrice, 9600);
  assert.equal(option.totalPriceCurrency, "USD");
  assert.equal(option.rating, 4.5);
  assert.equal(option.reviewCount, 812);
  // The numeric class comes from extracted_hotel_class; the documented
  // string hotel_class display text is neither used nor fatal.
  assert.equal(option.hotelClass, 4);
  assert.deepEqual(option.amenities, ["Free Wi-Fi", "Breakfast included"]);
  assert.equal(option.propertyUrl, "https://example.com/property");
  assert.equal(option.imageUrl, "https://example.com/image.jpg");
  assert.equal(option.locationText, null);
  assert.equal(option.neighborhood, null);
  assert.equal(option.trustStatus, "search_estimate");
  // Raw provider metadata never reaches the projection.
  const serialized = JSON.stringify(estimate);
  assert.equal(serialized.includes("raw-provider-search-id"), false);
  assert.equal(serialized.includes("search_metadata"), false);
  assert.equal(serialized.includes("4-star hotel"), false);
  // Deterministic: same input, same output.
  const again = projectSerpApiHotelEstimate(serpApiInput(serpApiBody()));
  assert.deepEqual(again, estimate);
});

test("rejects malformed, empty, and hostile Google Hotels responses safely", () => {
  assert.equal(projectSerpApiHotelEstimate(serpApiInput(null)), null);
  assert.equal(projectSerpApiHotelEstimate(serpApiInput({})), null);
  assert.equal(projectSerpApiHotelEstimate(serpApiInput({ properties: [] })), null);
  assert.equal(projectSerpApiHotelEstimate(serpApiInput({ properties: [{ type: "wrong", name: "X" }] })), null);
  assert.equal(projectSerpApiHotelEstimate(serpApiInput({ properties: [{ type: "hotel", name: "" }] })), null);
  assert.equal(
    projectSerpApiHotelEstimate(serpApiInput({ properties: [{ type: "hotel", name: "X", overall_rating: "high" }] })),
    null,
  );
  assert.equal(
    projectSerpApiHotelEstimate(serpApiInput({ properties: [{ type: "hotel", name: "X", reviews: "many" }] })),
    null,
  );
  assert.equal(
    projectSerpApiHotelEstimate(serpApiInput({ properties: [{ type: "hotel", name: "X", extracted_hotel_class: "five" }] })),
    null,
  );
  assert.equal(
    projectSerpApiHotelEstimate(serpApiInput({ properties: [serpApiProperty({ link: "javascript:alert(1)" })] })),
    null,
  );
  // The old invented response shape must no longer project.
  assert.equal(
    projectSerpApiHotelEstimate(serpApiInput({ properties: [{ type: "google_hotels", name: "Legacy", rates: [{ per_night: { lowest: "$1,200" } }] }] })),
    null,
  );
  // Unparseable displayed prices must not fabricate numbers.
  assert.equal(
    projectSerpApiHotelEstimate(serpApiInput({ properties: [serpApiProperty({ rate_per_night: { lowest: "free" }, total_rate: { lowest: "$9,600" } })] })),
    null,
  );
});

test("vacation rentals are excluded while sibling hotels survive", () => {
  const rental = {
    type: "vacation rental",
    name: "Le Sabot Ubud",
    rate_per_night: { lowest: "$114", extracted_lowest: 114 },
    total_rate: { lowest: "$114", extracted_lowest: 114 },
  };
  // A vacation rental alone produces no hotel options.
  assert.equal(projectSerpApiHotelEstimate(serpApiInput({ properties: [rental] })), null);
  // Mixed results: the rental is skipped and the hotel survives.
  const mixed = projectSerpApiHotelEstimate(serpApiInput({ properties: [rental, serpApiProperty()] }));
  assert.ok(mixed);
  assert.equal(mixed.options.length, 1);
  assert.equal(mixed.options[0].propertyName, "Example Grand Hotel");
});

test("the documented string hotel_class never rejects and the numeric class is used", () => {
  for (const display of ["5-star hotel", "Luxury hotel", "Boutique hotel"]) {
    const estimate = projectSerpApiHotelEstimate(
      serpApiInput({ properties: [serpApiProperty({ hotel_class: display, extracted_hotel_class: 5 })] }),
    );
    assert.ok(estimate, display);
    assert.equal(estimate.options[0].hotelClass, 5);
  }
  // Absent class stays null; a hostile extracted value rejects.
  const nullClass = projectSerpApiHotelEstimate(
    serpApiInput({ properties: [serpApiProperty({ hotel_class: undefined, extracted_hotel_class: undefined })] }),
  );
  assert.ok(nullClass);
  assert.equal(nullClass.options[0].hotelClass, null);
  assert.equal(
    projectSerpApiHotelEstimate(serpApiInput({ properties: [serpApiProperty({ extracted_hotel_class: "5" })] })),
    null,
  );
});

test("present malformed nightly/total prices and rate containers reject the complete response", () => {
  // A price is absent only when the rate container, `lowest`, is missing, or
  // explicitly null — any present non-string value is a hostile shape.
  for (const malformed of [1200, true, [], {}]) {
    assert.equal(
      projectSerpApiHotelEstimate(serpApiInput({
        properties: [serpApiProperty({ rate_per_night: { lowest: malformed }, total_rate: { lowest: "$9,600" } })],
      })),
      null,
      `malformed nightly ${JSON.stringify(malformed)} must reject`,
    );
    assert.equal(
      projectSerpApiHotelEstimate(serpApiInput({
        properties: [serpApiProperty({ rate_per_night: { lowest: "$1,200" }, total_rate: { lowest: malformed } })],
      })),
      null,
      `malformed total ${JSON.stringify(malformed)} must reject`,
    );
  }
  // A present rate container that is neither an object nor null is a
  // malformed rate structure, not absence.
  for (const container of [[], "cheese", 5, true]) {
    assert.equal(
      projectSerpApiHotelEstimate(serpApiInput({
        properties: [serpApiProperty({ rate_per_night: container, total_rate: { lowest: "$9,600" } })],
      })),
      null,
      `malformed rate_per_night ${JSON.stringify(container)} must reject`,
    );
    assert.equal(
      projectSerpApiHotelEstimate(serpApiInput({
        properties: [serpApiProperty({ rate_per_night: { lowest: "$1,200" }, total_rate: container })],
      })),
      null,
      `malformed total_rate ${JSON.stringify(container)} must reject`,
    );
  }
  // Genuine absence — missing `lowest` and explicit `lowest: null` — stays
  // nullable, and the provider input object is never modified.
  const absentInput = serpApiInput({
    properties: [serpApiProperty({ rate_per_night: { lowest: null }, total_rate: {} })],
  });
  const absentSnapshot = JSON.stringify(absentInput);
  const absent = projectSerpApiHotelEstimate(absentInput);
  assert.ok(absent);
  assert.equal(absent.options[0].nightlyPrice, null);
  assert.equal(absent.options[0].totalPrice, null);
  assert.equal(absent.options[0].trustStatus, "price_unavailable");
  assert.equal(JSON.stringify(absentInput), absentSnapshot);
  // Valid string prices still parse exactly with nightly/total independence.
  const valid = projectSerpApiHotelEstimate(serpApiInput(serpApiBody()));
  assert.ok(valid);
  assert.equal(valid.options[0].nightlyPrice, 1200);
  assert.equal(valid.options[0].totalPrice, 9600);
});

test("absent prices stay null and trust status reflects them", () => {
  const estimate = projectSerpApiHotelEstimate(serpApiInput({
    properties: [serpApiProperty({ rate_per_night: undefined, total_rate: undefined })],
  }));
  assert.ok(estimate);
  assert.equal(estimate.options[0].nightlyPrice, null);
  assert.equal(estimate.options[0].nightlyPriceCurrency, null);
  assert.equal(estimate.options[0].totalPrice, null);
  assert.equal(estimate.options[0].totalPriceCurrency, null);
  assert.equal(estimate.options[0].trustStatus, "price_unavailable");
});

test("accepted estimate round-trips through the signed hotel-stage envelope", () => {
  const estimate = projectSerpApiHotelEstimate(serpApiInput(serpApiBody()));
  assert.ok(estimate);
  const envelope = buildStrategyRunStagePayload("hotel", interpretedEnvelope(estimate));
  assert.equal(envelope.stage, "hotel");
  const validated = validateStrategyRunStagePayload(
    { schemaVersion: 1, stage: "hotel", interpreted: interpretedEnvelope(estimate) },
    "hotel",
  );
  assert.deepEqual(validated.interpreted.hotelPlanningEstimate, estimate);
  // Case-insensitive leak check on the serialized signed payload.
  const serialized = JSON.stringify(envelope).toLowerCase();
  for (const forbidden of ["api_key", "apikey", "search_metadata", "raw-provider-search-id", "token", "signature"]) {
    assert.equal(serialized.includes(forbidden), false, `payload must not contain ${forbidden}`);
  }
});
