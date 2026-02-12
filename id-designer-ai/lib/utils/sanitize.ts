const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;
// Keep LF (\n, \u000A) so we can preserve multiline content (e.g., base materials),
// but strip other control chars.
const CONTROL_CHARS_EXCEPT_LF_REGEX = /[\u0000-\u0009\u000B-\u001F\u007F]/g;

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

export function sanitizeMultilineText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(CONTROL_CHARS_EXCEPT_LF_REGEX, "")
    .trim();
}

export function sanitizeOptionalMultilineText(input?: string | null): string | undefined {
  if (!input) {
    return undefined;
  }
  const value = sanitizeMultilineText(input);
  return value.length > 0 ? value : undefined;
}
