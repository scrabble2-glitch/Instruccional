import { sha256 } from "@/lib/utils/hash";

function removeDiacritics(input: string): string {
  // Normalize to NFKD and strip combining marks (accents).
  return input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function slugify(input: string, maxLength = 60): string {
  const normalized = removeDiacritics(input).toLowerCase();
  const slug = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  const trimmed = slug.length > maxLength ? slug.slice(0, maxLength).replace(/-+$/, "") : slug;
  return trimmed || "curso";
}

export function stableSlugWithHash(input: string, maxSlugLength = 48, hashLength = 8): string {
  const value = input.trim() || "curso";
  const slug = slugify(value, maxSlugLength);
  const hash = sha256(value).slice(0, hashLength);
  return `${slug}-${hash}`;
}

