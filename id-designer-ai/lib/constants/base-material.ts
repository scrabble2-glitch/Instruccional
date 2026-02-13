// Base material constraints used by both UI and server routes.
//
// Note: Increasing these values increases request payload size and Gemini context usage.
// Keep them high enough for real documents, but not so high that prompts become unstable.

export const BASE_MATERIAL_MAX_CHARS = 120_000;
export const BASE_MATERIAL_MAX_BYTES = 10_000_000;

