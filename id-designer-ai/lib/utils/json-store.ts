import { tryParseJson } from "@/lib/utils/json";

export function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

export function parseStoredJson<T>(value: string, label: string): T {
  const parsed = tryParseJson<T>(value);

  if (!parsed.ok) {
    throw new Error(`${label} contiene JSON inválido: ${parsed.error}`);
  }

  return parsed.value;
}
