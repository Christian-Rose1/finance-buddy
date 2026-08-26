import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isUuid, validateGoalFormData } from "./goalForm";

function validForm(overrides: Record<string, string> = {}): FormData {
  const values = {
    title: "Europe trip",
    origins: "Denver, DEN",
    destinations: "Paris",
    earliestDeparture: "2027-04-03",
    latestReturn: "2027-04-30",
    minimumNights: "8",
    maximumNights: "16",
    travelerCount: "2",
    cabinPreference: "economy",
    optimizationPriority: "balanced",
    maximumCashBudget: "2000",
    status: "active",
    allowNewCards: "on",
    ...overrides,
  };
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
}

describe("validateGoalFormData", () => {
  it("normalizes a complete update while keeping catalog-independent values fixed", () => {
    const result = validateGoalFormData(validForm(), "update");

    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.deepEqual(result.data.origin, ["Denver", "DEN"]);
    assert.deepEqual(result.data.destinations, ["Paris"]);
    assert.equal(result.data.status, "active");
    assert.equal(result.data.currency, "USD");
    assert.equal(result.data.allowNewCards, true);
  });

  it("always creates goals as drafts even when a status is submitted", () => {
    const result = validateGoalFormData(validForm({ status: "completed" }), "create");

    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.equal(result.data.status, "draft");
  });

  it("rejects reversed dates and night ranges", () => {
    const dates = validateGoalFormData(
      validForm({ earliestDeparture: "2027-05-01", latestReturn: "2027-04-01" }),
      "update"
    );
    const nights = validateGoalFormData(
      validForm({ minimumNights: "10", maximumNights: "5" }),
      "update"
    );

    assert.deepEqual(dates, {
      valid: false,
      error: "Latest return cannot be before earliest departure.",
    });
    assert.deepEqual(nights, {
      valid: false,
      error: "Maximum nights cannot be less than minimum nights.",
    });
  });

  it("rejects invalid calendar dates", () => {
    assert.equal(
      validateGoalFormData(
        validForm({ earliestDeparture: "2027-02-29" }),
        "update"
      ).valid,
      false
    );
    assert.equal(
      validateGoalFormData(
        validForm({ latestReturn: "2027-04-31" }),
        "update"
      ).valid,
      false
    );
  });

  it("rejects negative and non-finite numeric values", () => {
    for (const [field, value] of [
      ["travelerCount", "-1"],
      ["travelerCount", "NaN"],
      ["minimumNights", "-1"],
      ["maximumNights", "Infinity"],
      ["maximumCashBudget", "-0.01"],
      ["maximumCashBudget", "NaN"],
      ["maximumCashBudget", "Infinity"],
    ] as const) {
      assert.equal(
        validateGoalFormData(validForm({ [field]: value }), "update").valid,
        false,
        `${field}=${value} should be rejected`
      );
    }
  });

  it("rejects unsupported enums, oversized values, and missing locations", () => {
    assert.equal(
      validateGoalFormData(validForm({ status: "deleted" }), "update").valid,
      false
    );
    assert.equal(
      validateGoalFormData(validForm({ travelerCount: "51" }), "update").valid,
      false
    );
    assert.equal(
      validateGoalFormData(validForm({ destinations: "" }), "update").valid,
      false
    );
  });
});

describe("isUuid", () => {
  it("accepts database UUIDs and rejects arbitrary identifiers", () => {
    assert.equal(isUuid("2cb72e1e-4a90-4ea6-85bb-622dbe6fcf10"), true);
    assert.equal(isUuid("goal-from-browser"), false);
  });
});
