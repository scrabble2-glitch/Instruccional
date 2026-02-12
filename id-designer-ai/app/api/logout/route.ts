import { clearSessionCookieHeader } from "@/lib/auth/session";
import { jsonResponse } from "@/lib/utils/request";

export async function POST(): Promise<Response> {
  return jsonResponse(
    { ok: true },
    200,
    {
      "Set-Cookie": clearSessionCookieHeader()
    }
  );
}
