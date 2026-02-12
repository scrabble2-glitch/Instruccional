import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SINGLE_USER_PASSWORD: z.string().min(8),
  SESSION_SECRET: z.string().min(16),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  DEFAULT_SAFETY_MODE: z.enum(["normal", "estricto"]).default("normal"),
  CACHE_TTL_MINUTES: z.coerce.number().int().positive().default(1440),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  INPUT_TOKEN_COST_PER_MILLION: z.coerce.number().nonnegative().default(0.1),
  OUTPUT_TOKEN_COST_PER_MILLION: z.coerce.number().nonnegative().default(0.4)
});

export const env = EnvSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  APP_URL: process.env.APP_URL,
  SINGLE_USER_PASSWORD: process.env.SINGLE_USER_PASSWORD,
  SESSION_SECRET: process.env.SESSION_SECRET,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  DEFAULT_SAFETY_MODE: process.env.DEFAULT_SAFETY_MODE,
  CACHE_TTL_MINUTES: process.env.CACHE_TTL_MINUTES,
  RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE,
  INPUT_TOKEN_COST_PER_MILLION: process.env.INPUT_TOKEN_COST_PER_MILLION,
  OUTPUT_TOKEN_COST_PER_MILLION: process.env.OUTPUT_TOKEN_COST_PER_MILLION
});

export type SafetyMode = "normal" | "estricto";
