import { createSessionCookieHeader, isPasswordValid } from "@/lib/auth/session";
import { jsonResponse } from "@/lib/utils/request";
import { sanitizeText } from "@/lib/utils/sanitize";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Payload JSON inválido." }, 400);
  }

  const password =
    payload && typeof payload === "object" && "password" in payload
      ? sanitizeText(String((payload as { password: unknown }).password ?? ""))
      : "";

  if (!isPasswordValid(password)) {
    return jsonResponse({ error: "Credenciales inválidas." }, 401);
  }

  return jsonResponse(
    { ok: true },
    200,
    {
      "Set-Cookie": createSessionCookieHeader()
    }
  );
}
