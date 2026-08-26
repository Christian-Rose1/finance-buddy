const DEFAULT_AUTH_REDIRECT = "/dashboard";

export function safeAuthRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_AUTH_REDIRECT;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }

  if (decoded.startsWith("//") || decoded.includes("\\")) {
    return DEFAULT_AUTH_REDIRECT;
  }

  return value;
}
