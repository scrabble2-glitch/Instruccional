import { env } from "@/lib/env";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
  limit: number;
}

export function applyRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  const limit = env.RATE_LIMIT_PER_MINUTE;
  const windowMs = 60_000;

  const current = buckets.get(ip);
  if (!current || current.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: limit - 1,
      resetInSeconds: 60,
      limit
    };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetInSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      limit
    };
  }

  current.count += 1;
  buckets.set(ip, current);

  return {
    allowed: true,
    remaining: limit - current.count,
    resetInSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    limit
  };
}

export function resetRateLimiterForTests(): void {
  buckets.clear();
}
