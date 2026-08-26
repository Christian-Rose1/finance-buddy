export function formatMoney(value: number, currency: string | null): string {
  const normalizedCurrency = currency?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    return `${value.toFixed(2)} (currency unknown)`;
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${normalizedCurrency}`;
  }
}
