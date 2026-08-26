import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isWalletEntityId,
  validateWalletBenefitStateForm,
} from "./benefitStateForm";

function form(values: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

describe("validateWalletBenefitStateForm", () => {
  it("accepts bounded usage and normalizes date-only values", () => {
    const result = validateWalletBenefitStateForm(
      form({
        remainingValue: "75",
        usedValue: "25",
        expiresAt: "2026-12-31",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
      }),
      100
    );

    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.equal(result.data.remainingValue, 75);
    assert.equal(result.data.usedValue, 25);
    assert.equal(result.data.periodStart, "2026-01-01T00:00:00.000Z");
    assert.equal(result.data.periodEnd, "2026-12-31T23:59:59.999Z");
  });

  it("rejects values above the catalog limit", () => {
    const result = validateWalletBenefitStateForm(
      form({ remainingValue: "80", usedValue: "30" }),
      100
    );

    assert.deepEqual(result, {
      valid: false,
      error: "Benefit usage cannot exceed the catalog limit.",
    });
  });

  it("rejects negative, missing, and non-finite tracked values", () => {
    for (const values of [
      { remainingValue: "-1", usedValue: "0" },
      { remainingValue: "0", usedValue: "-1" },
      { remainingValue: "NaN", usedValue: "0" },
      { remainingValue: "0", usedValue: "Infinity" },
      { remainingValue: "", usedValue: "0" },
      { remainingValue: "0", usedValue: "" },
    ]) {
      assert.equal(
        validateWalletBenefitStateForm(form(values), 100).valid,
        false,
        JSON.stringify(values)
      );
    }
  });

  it("ignores monetary input when the catalog defines no value", () => {
    const result = validateWalletBenefitStateForm(
      form({ remainingValue: "999", usedValue: "999" }),
      null
    );

    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.equal("remainingValue" in result.data, false);
    assert.equal("usedValue" in result.data, false);
  });

  it("ignores browser-supplied catalog facts and activation state", () => {
    const result = validateWalletBenefitStateForm(
      form({
        remainingValue: "75",
        usedValue: "25",
        title: "Injected title",
        fixedValue: "999999",
        annualLimit: "999999",
        productBenefitId: "injected-benefit",
        active: "true",
        activatedAt: "2020-01-01T00:00:00.000Z",
      }),
      100
    );

    assert.equal(result.valid, true);
    if (!result.valid) return;
    assert.deepEqual(Object.keys(result.data).sort(), [
      "expiresAt",
      "periodEnd",
      "periodStart",
      "remainingValue",
      "usedValue",
    ]);
  });

  it("rejects invalid or reversed dates", () => {
    assert.equal(
      validateWalletBenefitStateForm(form({ expiresAt: "2026-02-30" }), null)
        .valid,
      false
    );
    assert.equal(
      validateWalletBenefitStateForm(
        form({ periodStart: "2026-08-02", periodEnd: "2026-08-01" }),
        null
      ).valid,
      false
    );
  });
});

describe("isWalletEntityId", () => {
  it("accepts UUIDs and rejects arbitrary identifiers", () => {
    assert.equal(
      isWalletEntityId("2cb72e1e-4a90-4ea6-85bb-622dbe6fcf10"),
      true
    );
    assert.equal(isWalletEntityId("benefit-from-browser"), false);
  });
});
