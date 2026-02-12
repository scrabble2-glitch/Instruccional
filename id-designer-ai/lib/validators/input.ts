import { z } from "zod";
import { env } from "@/lib/env";
import { sanitizeOptionalText, sanitizeText } from "@/lib/utils/sanitize";

export const GenerationTemplateSchema = z.enum([
  "general",
  "curso-corporativo",
  "curso-academico",
  "microlearning"
]);

export const GenerationScopeSchema = z.enum([
  "all",
  "course_structure",
  "learning_activities",
  "assessment",
  "alignment_matrix",
  "production_notes"
]);

export const GenerationModeSchema = z.enum(["full", "evaluation-only", "ova-storyboard"]);

const ProjectBriefSchema = z
  .object({
    name: z.string().min(3).max(120),
    audience: z.string().min(3).max(300),
    level: z.string().min(2).max(100),
    durationHours: z.coerce.number().positive().max(300),
    modality: z.enum(["virtual", "presencial", "blended"]),
    generalObjectives: z.string().min(10).max(4000),
    restrictions: z.string().max(4000).optional(),
    availableResources: z.string().max(4000).optional(),
    pedagogicalApproach: z.string().max(1200).optional(),
    evaluationApproach: z.string().max(1200).optional(),
    language: z.string().min(2).max(60).default("español"),
    tone: z.string().min(2).max(60).default("profesional")
  })
  .strict();

const GenerationOptionsSchema = z
  .object({
    model: z.string().min(3).max(80).optional(),
    safetyMode: z.enum(["normal", "estricto"]).default(env.DEFAULT_SAFETY_MODE),
    template: GenerationTemplateSchema.default("general"),
    mode: GenerationModeSchema.default("full")
  })
  .strict();

const NewRequestSchema = z
  .object({
    requestType: z.literal("new"),
    project: ProjectBriefSchema,
    options: GenerationOptionsSchema
  })
  .strict();

const RefineRequestSchema = z
  .object({
    requestType: z.literal("refine"),
    projectId: z.string().min(10),
    baseVersionId: z.string().min(10).optional(),
    editInstruction: z.string().min(5).max(2000),
    targetSection: GenerationScopeSchema.default("all"),
    options: GenerationOptionsSchema
  })
  .strict();

export const GenerateRequestSchema = z.discriminatedUnion("requestType", [
  NewRequestSchema,
  RefineRequestSchema
]);

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
export type ProjectBrief = z.infer<typeof ProjectBriefSchema>;

export function sanitizeGeneratePayload(payload: unknown): unknown {
  if (typeof payload === "string") {
    return sanitizeText(payload);
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeGeneratePayload(item));
  }

  if (payload && typeof payload === "object") {
    return Object.entries(payload).reduce<Record<string, unknown>>((acc, [key, value]) => {
      if (value === null || value === undefined) {
        return acc;
      }

      if (typeof value === "string") {
        const sanitized = sanitizeOptionalText(value);
        if (sanitized !== undefined) {
          acc[key] = sanitized;
        }
        return acc;
      }

      acc[key] = sanitizeGeneratePayload(value);
      return acc;
    }, {});
  }

  return payload;
}
