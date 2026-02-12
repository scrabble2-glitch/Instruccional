const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;

export function sanitizeText(input: string): string {
  return input.replace(CONTROL_CHARS_REGEX, " ").replace(/\s+/g, " ").trim();
}

export function sanitizeOptionalText(input?: string | null): string | undefined {
  if (!input) {
    return undefined;
  }
  const value = sanitizeText(input);
  return value.length > 0 ? value : undefined;
}
