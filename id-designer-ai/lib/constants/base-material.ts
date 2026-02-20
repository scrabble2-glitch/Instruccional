// Base material constraints used by both UI and server routes.
//
// Note: Increasing these values increases request payload size and Gemini context usage.
// Keep them high enough for real documents, but not so high that prompts become unstable.

export const BASE_MATERIAL_MAX_CHARS = 120_000;
export const BASE_MATERIAL_MAX_BYTES = 20_000_000;
export const BASE_MATERIAL_MAX_OFFICE_BYTES = 80_000_000;

const OFFICE_EXTENSIONS = new Set(["docx", "pptx"]);
const OFFICE_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);

function getExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ext.trim();
}

export function isOfficeBaseMaterial(filename: string, mimeType?: string): boolean {
  const ext = getExtension(filename);
  if (OFFICE_EXTENSIONS.has(ext)) return true;
  return Boolean(mimeType && OFFICE_MIME_TYPES.has(mimeType));
}

export function resolveBaseMaterialMaxBytes(filename: string, mimeType?: string): number {
  return isOfficeBaseMaterial(filename, mimeType) ? BASE_MATERIAL_MAX_OFFICE_BYTES : BASE_MATERIAL_MAX_BYTES;
}
