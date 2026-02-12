import { ZodError, z } from "zod";
import { isAuthenticated } from "@/lib/auth/session";
import { applyRateLimit } from "@/lib/cache/rate-limit";
import { env } from "@/lib/env";
import { BASE_MATERIAL_MAX_BYTES, BASE_MATERIAL_MAX_CHARS, extractBaseMaterialText } from "@/lib/services/base-material-extract";
import { getClientIp, getRequestId, jsonResponse } from "@/lib/utils/request";
import { sanitizeMultilineText, sanitizeOptionalText } from "@/lib/utils/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  if (entry.size > BASE_MATERIAL_MAX_BYTES) {
    return jsonResponse(
      {
        error: `Archivo demasiado grande. Máximo ${Math.round(BASE_MATERIAL_MAX_BYTES / 1000)} KB.`,
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
    const publicMessage = rawMessage.includes("GEMINI_API_KEY")
      ? rawMessage
      : rawMessage === "Formato no soportado."
        ? "Formato no soportado. Usa PDF, DOCX, PPTX, texto (.txt/.md/.json) o imágenes (PNG/JPG/WEBP)."
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

