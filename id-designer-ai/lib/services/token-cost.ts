import { env } from "@/lib/env";

export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateCostUsd(tokenInput: number, tokenOutput: number): number {
  const inputCost = (tokenInput / 1_000_000) * env.INPUT_TOKEN_COST_PER_MILLION;
  const outputCost = (tokenOutput / 1_000_000) * env.OUTPUT_TOKEN_COST_PER_MILLION;
  return Number((inputCost + outputCost).toFixed(6));
}
