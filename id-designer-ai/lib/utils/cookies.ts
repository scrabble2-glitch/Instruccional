export function parseCookieHeader(headerValue: string | null): Record<string, string> {
  if (!headerValue) {
    return {};
  }

  return headerValue
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, chunk) => {
      const [key, ...valueParts] = chunk.split("=");
      if (!key || valueParts.length === 0) {
        return acc;
      }
      acc[key] = decodeURIComponent(valueParts.join("="));
      return acc;
    }, {});
}
