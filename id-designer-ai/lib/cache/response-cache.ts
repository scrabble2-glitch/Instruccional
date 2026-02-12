import { CacheEntry } from "@prisma/client";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { serializeJson } from "@/lib/utils/json-store";

export async function getValidCacheEntry(key: string): Promise<CacheEntry | null> {
  const entry = await prisma.cacheEntry.findUnique({ where: { key } });

  if (!entry) {
    return null;
  }

  if (entry.expiresAt.getTime() < Date.now()) {
    await prisma.cacheEntry.delete({ where: { key } }).catch(() => undefined);
    return null;
  }

  return entry;
}

export async function upsertCacheEntry(params: {
  key: string;
  model: string;
  safetyMode: string;
  requestPayload: unknown;
  responseJson: unknown;
  qualityReport: unknown;
  tokenInput: number;
  tokenOutput: number;
  estimatedCostUsd: number;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + env.CACHE_TTL_MINUTES * 60 * 1000);

  await prisma.cacheEntry.upsert({
    where: { key: params.key },
    update: {
      model: params.model,
      safetyMode: params.safetyMode,
      requestPayload: serializeJson(params.requestPayload),
      responseJson: serializeJson(params.responseJson),
      qualityReport: serializeJson(params.qualityReport),
      tokenInput: params.tokenInput,
      tokenOutput: params.tokenOutput,
      estimatedCostUsd: params.estimatedCostUsd,
      expiresAt
    },
    create: {
      key: params.key,
      model: params.model,
      safetyMode: params.safetyMode,
      requestPayload: serializeJson(params.requestPayload),
      responseJson: serializeJson(params.responseJson),
      qualityReport: serializeJson(params.qualityReport),
      tokenInput: params.tokenInput,
      tokenOutput: params.tokenOutput,
      estimatedCostUsd: params.estimatedCostUsd,
      expiresAt
    }
  });
}
