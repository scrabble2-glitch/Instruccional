import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";
import { parseCookieHeader } from "@/lib/utils/cookies";

const COOKIE_NAME = "id_designer_session";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const PAYLOAD = "single-user-authorized";

function signPayload(): string {
  return createHmac("sha256", env.SESSION_SECRET).update(PAYLOAD).digest("hex");
}

export function getSessionCookieName(): string {
  return COOKIE_NAME;
}

export function createSessionCookieHeader(): string {
  const signature = signPayload();
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(signature)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure}`;
}

export function clearSessionCookieHeader(): string {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function isPasswordValid(password: string): boolean {
  const expected = Buffer.from(env.SINGLE_USER_PASSWORD);
  const received = Buffer.from(password);

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}

export function isAuthenticated(request: Request): boolean {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const token = cookies[COOKIE_NAME];

  if (!token) {
    return false;
  }

  const expected = Buffer.from(signPayload());
  const received = Buffer.from(token);

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}
