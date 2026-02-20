import { isAuthenticated } from "@/lib/auth/session";
import { applyRateLimit } from "@/lib/cache/rate-limit";
import { env } from "@/lib/env";
import { callGeminiExtractTextFromMedia } from "@/lib/gemini/client";
import { getClientIp, getRequestId, jsonResponse } from "@/lib/utils/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+9f0AAAAASUVORK5CYII=";

export async function GET(request: Request): Promise<Response> {
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

  const apiKeyConfigured = Boolean(env.GEMINI_API_KEY?.trim());
  if (!apiKeyConfigured) {
    return jsonResponse(
      {
        requestId,
        apiKeyConfigured: false,
        model: env.GEMINI_MODEL,
        ok: false,
        message: "GEMINI_API_KEY no está configurada."
      },
      200,
      { "x-request-id": requestId }
    );
  }

  try {
    const result = await callGeminiExtractTextFromMedia({
      model: env.GEMINI_MODEL,
      safetyMode: env.DEFAULT_SAFETY_MODE,
      mimeType: "image/png",
      dataBase64: ONE_PIXEL_PNG_BASE64,
      instruction:
        "Responde solo con: OK. Si no puedes procesar el archivo, indica brevemente el motivo."
    });

    return jsonResponse(
      {
        requestId,
        apiKeyConfigured: true,
        model: env.GEMINI_MODEL,
        ok: true,
        sampleResponse: result.rawText.slice(0, 200)
      },
      200,
      { "x-request-id": requestId }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return jsonResponse(
      {
        requestId,
        apiKeyConfigured: true,
        model: env.GEMINI_MODEL,
        ok: false,
        message
      },
      200,
      { "x-request-id": requestId }
    );
  }
}
