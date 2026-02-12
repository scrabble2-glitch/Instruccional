import { z } from "zod";
import { env } from "@/lib/env";
import { sanitizeOptionalMultilineText, sanitizeOptionalText, sanitizeText } from "@/lib/utils/sanitize";

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

export const BaseMaterialStrategySchema = z.enum(["keep_all", "analyze_storyboard"]);

const BASE_MATERIAL_MAX_CHARS = 30_000;

const BaseMaterialSchema = z
  .object({
    filename: z.string().min(1).max(200),
    mimeType: z.string().min(1).max(120),
    content: z.string().min(1).max(BASE_MATERIAL_MAX_CHARS)
  })
  .strict();

const ProjectBriefSchema = z
  .object({
    name: z.string().min(3).max(120),
    resourceNumber: z.string().min(1).max(50),
    resourceName: z.string().min(2).max(200),
    baseMaterialStrategy: BaseMaterialStrategySchema.default("analyze_storyboard"),
    audience: z.string().min(3).max(300).default("No especificada"),
    level: z.string().min(2).max(100).default("No especificado"),
    durationHours: z.coerce.number().positive().max(300),
    modality: z.enum(["virtual", "presencial", "blended"]).default("virtual"),
    generalObjectives: z.string().max(4000).default(""),
    restrictions: z.string().max(4000).optional(),
    availableResources: z.string().max(4000).optional(),
    pedagogicalApproach: z.string().max(1200).optional(),
    evaluationApproach: z.string().max(1200).optional(),
    baseMaterial: BaseMaterialSchema.optional(),
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

const GenerateRequestSchemaBase = z.discriminatedUnion("requestType", [NewRequestSchema, RefineRequestSchema]);

export const GenerateRequestSchema = GenerateRequestSchemaBase.superRefine((data, ctx) => {
  if (data.requestType !== "new") {
    return;
  }

  const baseContent = data.project.baseMaterial?.content?.trim() ?? "";

  if (data.options.mode === "ova-storyboard" && baseContent.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["project", "baseMaterial", "content"],
      message: "El material base es obligatorio para generar un guion técnico instruccional."
    });
  }

  if (data.project.baseMaterialStrategy === "keep_all" && baseContent.length >= BASE_MATERIAL_MAX_CHARS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["project", "baseMaterialStrategy"],
      message:
        "La estrategia 'mantener todo el contenido' requiere que el material base no esté truncado. " +
        `Reduce el contenido a menos de ${BASE_MATERIAL_MAX_CHARS.toLocaleString("es-ES")} caracteres o divide el archivo.`
    });
  }
});

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

      if (key === "baseMaterial" && value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        const filename = typeof record.filename === "string" ? sanitizeOptionalText(record.filename) : undefined;
        const mimeType = typeof record.mimeType === "string" ? sanitizeOptionalText(record.mimeType) : undefined;
        const content = typeof record.content === "string" ? sanitizeOptionalMultilineText(record.content) : undefined;

        const sanitized: Record<string, unknown> = {};
        if (filename !== undefined) sanitized.filename = filename;
        if (mimeType !== undefined) sanitized.mimeType = mimeType;
        if (content !== undefined) sanitized.content = content;

        if (Object.keys(sanitized).length > 0) {
          acc[key] = sanitized;
        }
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
