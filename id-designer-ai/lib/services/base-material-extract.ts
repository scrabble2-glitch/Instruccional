import { env, SafetyMode } from "@/lib/env";
import { callGeminiExtractTextFromMedia } from "@/lib/gemini/client";

export const BASE_MATERIAL_MAX_CHARS = 30_000;
export const BASE_MATERIAL_MAX_BYTES = 2_000_000;

export type SupportedBaseMaterialKind = "text" | "pdf" | "docx" | "pptx" | "image";

function getExtension(filename: string): string {
  const raw = filename.split(".").pop()?.toLowerCase() ?? "";
  return raw.trim();
}

function inferMimeTypeFromExtension(ext: string): string | undefined {
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "json":
      return "application/json";
    case "csv":
      return "text/csv";
    case "md":
    case "markdown":
      return "text/markdown";
    case "txt":
      return "text/plain";
    case "rtf":
      return "application/rtf";
    case "html":
    case "htm":
      return "text/html";
    default:
      return undefined;
  }
}

function normalizeMimeType(filename: string, mimeType: string): string {
  const ext = getExtension(filename);
  if (!mimeType || mimeType === "application/octet-stream") {
    return inferMimeTypeFromExtension(ext) ?? mimeType;
  }
  return mimeType;
}

function isTextLikeMime(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/rtf";
}

function detectKind(filename: string, mimeType: string): SupportedBaseMaterialKind | null {
  const ext = getExtension(filename);

  if (mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  )
    return "docx";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    ext === "pptx"
  )
    return "pptx";
  if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";

  if (
    isTextLikeMime(mimeType) ||
    ["txt", "md", "markdown", "json", "csv", "rtf", "html", "htm"].includes(ext)
  ) {
    return "text";
  }

  return null;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#xA;/gi, "\n")
    .replace(/&#xD;/gi, "\n");
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const mod = (await import("pdf-parse")) as unknown as { default?: (data: Buffer) => Promise<{ text?: string }> };
  const pdfParse = mod.default ?? (mod as unknown as (data: Buffer) => Promise<{ text?: string }>);
  const result = await pdfParse(buffer);
  return result.text ?? "";
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const mod = (await import("mammoth")) as unknown as {
    default?: { extractRawText: (input: { buffer: Buffer }) => Promise<{ value?: string }> };
    extractRawText?: (input: { buffer: Buffer }) => Promise<{ value?: string }>;
  };
  const mammoth = mod.default ?? (mod as unknown as { extractRawText: (input: { buffer: Buffer }) => Promise<{ value?: string }> });
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  const mod = (await import("jszip")) as unknown as { default?: { loadAsync: (data: Buffer) => Promise<any> } };
  const JSZip = mod.default ?? (mod as unknown as { loadAsync: (data: Buffer) => Promise<any> });

  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((name) => name.startsWith("ppt/slides/slide") && name.endsWith(".xml"))
    .sort((a, b) => {
      const getIndex = (value: string) => {
        const match = value.match(/slide(\d+)\.xml$/);
        return match ? Number(match[1]) : 0;
      };
      return getIndex(a) - getIndex(b);
    });

  const parts: string[] = [];
  for (const slideName of slideNames) {
    const file = zip.file(slideName);
    if (!file) continue;
    const xml = (await file.async("text")) as string;
    const matches = xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g);
    for (const match of matches) {
      const raw = match[1] ?? "";
      const decoded = decodeXmlEntities(raw).trim();
      if (decoded) parts.push(decoded);
    }
  }

  return parts.join("\n");
}

async function extractImageText(buffer: Buffer, mimeType: string, safetyMode: SafetyMode): Promise<string> {
  const data = buffer.toString("base64");
  const result = await callGeminiExtractTextFromMedia({
    model: env.GEMINI_MODEL,
    safetyMode,
    mimeType,
    dataBase64: data,
    instruction:
      "Extrae el texto visible (OCR) de la imagen. " +
      "Si no hay texto legible, describe de forma concisa el contenido visual y posibles temas/ideas clave. " +
      "No inventes nombres propios ni cifras; si no estás seguro, dilo."
  });
  return result.rawText;
}

export async function extractBaseMaterialText(params: {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  safetyMode: SafetyMode;
}): Promise<{ kind: SupportedBaseMaterialKind; text: string }> {
  const effectiveMimeType = normalizeMimeType(params.filename, params.mimeType);
  const kind = detectKind(params.filename, effectiveMimeType);
  if (!kind) {
    throw new Error("Formato no soportado.");
  }

  switch (kind) {
    case "pdf":
      return { kind, text: await extractPdfText(params.buffer) };
    case "docx":
      return { kind, text: await extractDocxText(params.buffer) };
    case "pptx":
      return { kind, text: await extractPptxText(params.buffer) };
    case "image":
      return { kind, text: await extractImageText(params.buffer, effectiveMimeType, params.safetyMode) };
    case "text":
    default:
      return { kind: "text", text: params.buffer.toString("utf8") };
  }
}
