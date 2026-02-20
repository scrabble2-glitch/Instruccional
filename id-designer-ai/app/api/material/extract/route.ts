import { ZodError, z } from "zod";
import { isAuthenticated } from "@/lib/auth/session";
import { applyRateLimit } from "@/lib/cache/rate-limit";
import { resolveBaseMaterialMaxBytes } from "@/lib/constants/base-material";
import { env } from "@/lib/env";
import { BASE_MATERIAL_MAX_CHARS, extractBaseMaterialText } from "@/lib/services/base-material-extract";
import { getClientIp, getRequestId, jsonResponse } from "@/lib/utils/request";
import { sanitizeMultilineText, sanitizeOptionalText } from "@/lib/utils/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ResponseSchema = z
  .object({
    requestId: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    kind: z.enum(["text", "pdf", "docx", "pptx", "image"]),
    truncated: z.boolean(),
    charCount: z.number().int().nonnegative(),
    content: z.string()
  })
  .strict();

function formatZodError(error: ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
}

function formatBytesToMb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

function parseGeminiStatus(message: string): number | null {
  const match = message.match(/Gemini error \((\d+)\):/i);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  const ip = getClientIp(request);

  if (!isAuthenticated(request)) {
    return jsonResponse({ error: "No autorizado.", requestId }, 401, { "x-request-id": requestId });
  }

  const rateLimit = applyRateLimit(ip);
  if (!rateLimit.allowed) {
    return jsonResponse(
      {
        error: "Límite de solicitudes alcanzado. Intenta nuevamente en unos segundos.",
        requestId,
        limit: rateLimit.limit,
        resetInSeconds: rateLimit.resetInSeconds
      },
      429,
      {
        "x-request-id": requestId,
        "x-ratelimit-limit": String(rateLimit.limit),
        "x-ratelimit-remaining": String(rateLimit.remaining),
        "x-ratelimit-reset": String(rateLimit.resetInSeconds)
      }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ error: "No se pudo leer el archivo.", requestId }, 400, { "x-request-id": requestId });
  }

  const entry = formData.get("file");
  if (!(entry instanceof File)) {
    return jsonResponse({ error: "Archivo faltante. Envía el campo 'file'.", requestId }, 400, { "x-request-id": requestId });
  }

  const filename = sanitizeOptionalText(entry.name) ?? "material-base";
  const mimeType = sanitizeOptionalText(entry.type) ?? "application/octet-stream";
  const maxBytes = resolveBaseMaterialMaxBytes(filename, mimeType);

  if (entry.size > maxBytes) {
    return jsonResponse(
      {
        error: `Archivo demasiado grande. Máximo ${formatBytesToMb(maxBytes)} para este tipo de archivo.`,
        requestId
      },
      413,
      { "x-request-id": requestId }
    );
  }

  let buffer: Buffer;
  try {
    const arrayBuffer = await entry.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch {
    return jsonResponse({ error: "No se pudo procesar el archivo.", requestId }, 400, { "x-request-id": requestId });
  }

  const safetyMode = env.DEFAULT_SAFETY_MODE;

  try {
    const extracted = await extractBaseMaterialText({
      filename,
      mimeType,
      buffer,
      safetyMode
    });

    const sanitized = sanitizeMultilineText(extracted.text);
    if (sanitized.trim().length === 0) {
      throw new Error("NO_TEXT_EXTRACTED");
    }
    const truncated = sanitized.length > BASE_MATERIAL_MAX_CHARS;
    const content = truncated ? sanitized.slice(0, BASE_MATERIAL_MAX_CHARS) : sanitized;

    const payload = ResponseSchema.parse({
      requestId,
      filename,
      mimeType,
      kind: extracted.kind,
      truncated,
      charCount: content.length,
      content
    });

    return jsonResponse(payload, 200, {
      "x-request-id": requestId,
      "x-ratelimit-limit": String(rateLimit.limit),
      "x-ratelimit-remaining": String(rateLimit.remaining),
      "x-ratelimit-reset": String(rateLimit.resetInSeconds)
    });
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Error desconocido";
    const rawLower = rawMessage.toLowerCase();
    const geminiStatus = parseGeminiStatus(rawMessage);
    const publicMessage = rawMessage.includes("GEMINI_API_KEY")
      ? rawMessage
      : rawMessage === "NO_TEXT_EXTRACTED"
        ? "No se detectó texto utilizable en el archivo (puede ser un escaneo o contener solo imágenes). " +
          "Intenta con otro documento, pega el contenido manualmente o convierte el recurso a texto."
      : rawMessage === "Formato no soportado."
        ? "Formato no soportado. Usa PDF, DOCX, PPTX, texto (.txt/.md/.json) o imágenes (PNG/JPG/WEBP)."
      : geminiStatus === 401 || geminiStatus === 403
        ? "La conexión con Gemini fue rechazada (API key inválida o sin permisos). " +
          "Verifica GEMINI_API_KEY y los permisos del proyecto en Google AI Studio."
      : geminiStatus === 404
        ? "El modelo configurado no está disponible para esta cuenta/proyecto. " +
          "Cambia GEMINI_MODEL a gemini-2.5-pro o habilita acceso al modelo actual."
      : geminiStatus === 429
        ? "Gemini reportó límite de cuota o rate limit. Espera unos minutos o revisa la cuota del proyecto."
      : geminiStatus === 400
        ? "Gemini no pudo procesar este archivo (tipo o tamaño no compatible para extracción directa). " +
          "Intenta exportarlo a PDF de texto o dividir el recurso."
      : rawLower.includes("gemini error")
        ? "No fue posible extraer texto automáticamente con IA para este archivo. " +
          "Intenta exportarlo a PDF de texto o pega el contenido manualmente."
      : rawLower.includes("corrupt")
        || rawLower.includes("malformed")
        || rawLower.includes("zip")
        || rawLower.includes("central directory")
        || rawLower.includes("end of data")
        ? "El archivo parece dañado, protegido o con una estructura no compatible. " +
          "Intenta abrirlo y volver a guardarlo como PPTX/DOCX/PDF, luego cárgalo de nuevo."
        : "No fue posible extraer texto del archivo. Intenta con otro documento o pega el contenido manualmente.";

    console.error(
      JSON.stringify({
        level: "error",
        event: "material.extract.error",
        requestId,
        ip,
        filename,
        mimeType,
        message: rawMessage
      })
    );

    return jsonResponse({ error: publicMessage, requestId }, 400, { "x-request-id": requestId });
  }
}
