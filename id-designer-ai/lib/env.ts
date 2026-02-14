import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SINGLE_USER_PASSWORD: z.string().min(8),
  SESSION_SECRET: z.string().min(16),
  // Allow booting the app (login, UI, DB) without Gemini configured.
  // Generation endpoints must validate it's present before calling Gemini.
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  DEFAULT_SAFETY_MODE: z.enum(["normal", "estricto"]).default("normal"),
  CACHE_TTL_MINUTES: z.coerce.number().int().positive().default(1440),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  INPUT_TOKEN_COST_PER_MILLION: z.coerce.number().nonnegative().default(0.1),
  OUTPUT_TOKEN_COST_PER_MILLION: z.coerce.number().nonnegative().default(0.4),
  // Freepik (optional) - used to fetch slide visuals for PPTX storyboard exports.
  FREEPIK_API_KEY: z.string().default(""),
  FREEPIK_API_BASE_URL: z.string().url().default("https://api.freepik.com"),
  // Cloudflare R2 (S3 compatible) - optional
  R2_ACCOUNT_ID: z.string().default(""),
  R2_ACCESS_KEY_ID: z.string().default(""),
  R2_SECRET_ACCESS_KEY: z.string().default(""),
  R2_BUCKET: z.string().default(""),
  R2_PREFIX_BASE: z.string().default("cursos"),
  R2_REGION: z.string().default("auto"),
  // Local filesystem (optional) - intended for development workflows.
  LOCAL_COURSE_ROOT_DIR: z.string().default("")
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
  OUTPUT_TOKEN_COST_PER_MILLION: process.env.OUTPUT_TOKEN_COST_PER_MILLION,
  FREEPIK_API_KEY: process.env.FREEPIK_API_KEY,
  FREEPIK_API_BASE_URL: process.env.FREEPIK_API_BASE_URL,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET: process.env.R2_BUCKET,
  R2_PREFIX_BASE: process.env.R2_PREFIX_BASE,
  R2_REGION: process.env.R2_REGION,
  LOCAL_COURSE_ROOT_DIR: process.env.LOCAL_COURSE_ROOT_DIR
});

export type SafetyMode = "normal" | "estricto";
