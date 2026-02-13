import { z } from "zod";
import { isAuthenticated } from "@/lib/auth/session";
import { applyRateLimit } from "@/lib/cache/rate-limit";
import { ensureCourseFolderLocal } from "@/lib/local/course-folders";
import { ensureCourseFolderInR2 } from "@/lib/r2/course-folders";
import { getClientIp, getRequestId, jsonResponse } from "@/lib/utils/request";
import { sanitizeText } from "@/lib/utils/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EnsureFolderSchema = z.object({
  courseName: z.string().min(1).max(200)
});

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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Payload JSON inválido.", requestId }, 400, { "x-request-id": requestId });
  }

  const courseName =
    payload && typeof payload === "object" && "courseName" in payload ? sanitizeText(String(payload.courseName ?? "")) : "";

  const validation = EnsureFolderSchema.safeParse({ courseName });
  if (!validation.success) {
    return jsonResponse({ error: "Validación fallida.", requestId }, 400, { "x-request-id": requestId });
  }

  console.info(
    JSON.stringify({
      level: "info",
      event: "course.folder.request",
      requestId,
      ip,
      courseName
    })
  );

  const [localResult, r2Result] = await Promise.allSettled([
    ensureCourseFolderLocal(courseName),
    ensureCourseFolderInR2(courseName)
  ]);

  const response = {
    requestId,
    courseName,
    local: localResult.status === "fulfilled" ? localResult.value : { enabled: false, skipped: true, reason: "Error" },
    r2: r2Result.status === "fulfilled" ? r2Result.value : { enabled: false, skipped: true, reason: "Error" }
  };

  console.info(
    JSON.stringify({
      level: "info",
      event: "course.folder.success",
      requestId,
      courseName,
      localEnabled: response.local.enabled,
      r2Enabled: response.r2.enabled
    })
  );

  return jsonResponse(response, 200, {
    "x-request-id": requestId,
    "x-ratelimit-limit": String(rateLimit.limit),
    "x-ratelimit-remaining": String(rateLimit.remaining),
    "x-ratelimit-reset": String(rateLimit.resetInSeconds)
  });
}

