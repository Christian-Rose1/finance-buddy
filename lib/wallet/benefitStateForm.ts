import type { UpdateWalletBenefitInput } from "./benefitsRepository";

export type WalletBenefitStateValidationResult =
  | { valid: true; data: UpdateWalletBenefitInput }
  | { valid: false; error: string };

export function isWalletEntityId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

function textValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function parseDate(
  value: string,
  endOfDay: boolean
): { value: string | null; valid: boolean } {
  if (!value) return { value: null, valid: true };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { value: null, valid: false };
  }

  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const parsed = new Date(`${value}${suffix}`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return { value: null, valid: false };
  }
  return { value: parsed.toISOString(), valid: true };
}

export function validateWalletBenefitStateForm(
  formData: FormData,
  catalogLimit: number | null
): WalletBenefitStateValidationResult {
  let remainingValue: number | null | undefined;
  let usedValue: number | undefined;

  if (catalogLimit !== null) {
    const remainingRaw = textValue(formData, "remainingValue");
    const usedRaw = textValue(formData, "usedValue");
    remainingValue = Number(remainingRaw);
    usedValue = Number(usedRaw);

    if (
      !remainingRaw ||
      !usedRaw ||
      !Number.isFinite(remainingValue) ||
      !Number.isFinite(usedValue) ||
      remainingValue < 0 ||
      usedValue < 0
    ) {
      return {
        valid: false,
        error: "Remaining and used values must be non-negative numbers.",
      };
    }
    if (
      remainingValue > catalogLimit ||
      usedValue > catalogLimit ||
      remainingValue + usedValue > catalogLimit
    ) {
      return {
        valid: false,
        error: "Benefit usage cannot exceed the catalog limit.",
      };
    }
  }

  const expiresAt = parseDate(textValue(formData, "expiresAt"), true);
  const periodStart = parseDate(textValue(formData, "periodStart"), false);
  const periodEnd = parseDate(textValue(formData, "periodEnd"), true);
  if (!expiresAt.valid || !periodStart.valid || !periodEnd.valid) {
    return { valid: false, error: "Benefit dates must be valid calendar dates." };
  }
  if (
    periodStart.value !== null &&
    periodEnd.value !== null &&
    periodEnd.value < periodStart.value
  ) {
    return {
      valid: false,
      error: "Benefit period end cannot be before its start.",
    };
  }

  return {
    valid: true,
    data: {
      ...(catalogLimit === null
        ? {}
        : { remainingValue: remainingValue!, usedValue: usedValue! }),
      expiresAt: expiresAt.value,
      periodStart: periodStart.value,
      periodEnd: periodEnd.value,
    },
  };
}
