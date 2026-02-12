import { ZodError } from "zod";
import { isAuthenticated } from "@/lib/auth/session";
import { applyRateLimit } from "@/lib/cache/rate-limit";
import { generateAndStoreVersion } from "@/lib/services/generation-service";
import { getClientIp, getRequestId, jsonResponse } from "@/lib/utils/request";
import { GenerateRequestSchema, sanitizeGeneratePayload } from "@/lib/validators/input";

function formatZodError(error: ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  const ip = getClientIp(request);
  const startedAt = Date.now();

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

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return jsonResponse({ error: "No se pudo leer el payload.", requestId }, 400, { "x-request-id": requestId });
  }

  if (rawBody.length > 100_000) {
    return jsonResponse({ error: "Payload demasiado grande.", requestId }, 413, { "x-request-id": requestId });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "JSON inválido.", requestId }, 400, { "x-request-id": requestId });
  }

  const sanitizedPayload = sanitizeGeneratePayload(parsedJson);
  const validation = GenerateRequestSchema.safeParse(sanitizedPayload);

  if (!validation.success) {
    return jsonResponse(
      { error: "Validación fallida.", details: formatZodError(validation.error), requestId },
      400,
      { "x-request-id": requestId }
    );
  }

  try {
    console.info(
      JSON.stringify({
        level: "info",
        event: "generate.request",
        requestId,
        ip,
        requestType: validation.data.requestType,
        model: validation.data.options.model ?? null
      })
    );

    const result = await generateAndStoreVersion(validation.data);

    console.info(
      JSON.stringify({
        level: "info",
        event: "generate.success",
        requestId,
        projectId: result.projectId,
        versionId: result.versionId,
        fromCache: result.fromCache,
        elapsedMs: Date.now() - startedAt
      })
    );

    return jsonResponse(
      {
        requestId,
        projectId: result.projectId,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
        model: result.model,
        fromCache: result.fromCache,
        tokenInput: result.tokenInput,
        tokenOutput: result.tokenOutput,
        estimatedCostUsd: result.estimatedCostUsd,
        response: result.response,
        qualityReport: result.qualityReport
      },
      200,
      {
        "x-request-id": requestId,
        "x-ratelimit-limit": String(rateLimit.limit),
        "x-ratelimit-remaining": String(rateLimit.remaining),
        "x-ratelimit-reset": String(rateLimit.resetInSeconds)
      }
    );
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "Error desconocido";
    const publicMessage = rawMessage.includes("GEMINI_API_KEY")
      ? rawMessage
      : "No fue posible generar el diseño instruccional. Revisa los parámetros e intenta de nuevo.";

    console.error(
      JSON.stringify({
        level: "error",
        event: "generate.error",
        requestId,
        ip,
        message: rawMessage,
        elapsedMs: Date.now() - startedAt
      })
    );

    return jsonResponse(
      {
        error: publicMessage,
        requestId
      },
      500,
      { "x-request-id": requestId }
    );
  }
}
