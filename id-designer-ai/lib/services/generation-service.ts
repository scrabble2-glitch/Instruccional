import { getValidCacheEntry, upsertCacheEntry } from "@/lib/cache/response-cache";
import { env, SafetyMode } from "@/lib/env";
import { callGeminiGenerateContent } from "@/lib/gemini/client";
import { buildRepairPrompt, buildUserPrompt } from "@/lib/prompts/user-template";
import { SYSTEM_INSTRUCTION } from "@/lib/prompts/system-instruction";
import { prisma } from "@/lib/prisma";
import { ensureDatabaseReady } from "@/lib/services/db-init";
import { estimateCostUsd, estimateTokensFromText } from "@/lib/services/token-cost";
import { createVersionRecord } from "@/lib/services/versioning";
import { sha256 } from "@/lib/utils/hash";
import { extractJsonObject, tryParseJson } from "@/lib/utils/json";
import { parseStoredJson } from "@/lib/utils/json-store";
import { evaluateInstructionalQuality, QualityReport } from "@/lib/validators/quality";
import { GenerateRequest } from "@/lib/validators/input";
import {
  InstructionalDesignOutput,
  InstructionalDesignOutputSchema
} from "@/lib/validators/output-schema";

export interface GenerateAndStoreResult {
  projectId: string;
  versionId: string;
  versionNumber: number;
  response: InstructionalDesignOutput;
  qualityReport: QualityReport;
  tokenInput: number;
  tokenOutput: number;
  estimatedCostUsd: number;
  fromCache: boolean;
  cacheKey: string;
  model: string;
}

export interface GenerationHooks {
  onStage?: (stage: string, message: string) => void;
}

interface BuildContextResult {
  projectRecord: {
    id: string;
    durationHours: number;
  } | null;
  previousJson?: unknown;
  resolvedBaseVersionId?: string;
}

function summarizeZodError(error: string): string {
  return error.length > 1200 ? `${error.slice(0, 1200)}...` : error;
}

function parseAndValidateOutput(rawText: string):
  | { ok: true; value: InstructionalDesignOutput }
  | { ok: false; error: string } {
  const extracted = extractJsonObject(rawText);
  const parsed = tryParseJson<unknown>(extracted);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const validated = InstructionalDesignOutputSchema.safeParse(parsed.value);
  if (!validated.success) {
    return {
      ok: false,
      error: validated.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join(" | ")
    };
  }

  return { ok: true, value: validated.data };
}

async function generateStrictJson(params: {
  model: string;
  safetyMode: SafetyMode;
  userPrompt: string;
  hooks?: GenerationHooks;
}): Promise<{ output: InstructionalDesignOutput; tokenInput: number; tokenOutput: number }> {
  params.hooks?.onStage?.("model_request", "Enviando solicitud principal a Gemini.");
  const first = await callGeminiGenerateContent({
    model: params.model,
    safetyMode: params.safetyMode,
    systemInstruction: SYSTEM_INSTRUCTION,
    userPrompt: params.userPrompt
  });

  let parsed = parseAndValidateOutput(first.rawText);
  const promptTokens = first.usage?.promptTokenCount ?? estimateTokensFromText(params.userPrompt);
  let outputTokens =
    first.usage?.candidatesTokenCount ?? first.usage?.totalTokenCount ?? estimateTokensFromText(first.rawText);

  if (parsed.ok) {
    return {
      output: parsed.value,
      tokenInput: promptTokens,
      tokenOutput: outputTokens
    };
  }

  params.hooks?.onStage?.("model_repair", "JSON inválido detectado. Ejecutando reparación automática.");
  const repairPrompt = buildRepairPrompt(first.rawText, summarizeZodError(parsed.error));
  const repair = await callGeminiGenerateContent({
    model: params.model,
    safetyMode: params.safetyMode,
    systemInstruction: SYSTEM_INSTRUCTION,
    userPrompt: repairPrompt
  });

  parsed = parseAndValidateOutput(repair.rawText);
  outputTokens +=
    repair.usage?.candidatesTokenCount ?? repair.usage?.totalTokenCount ?? estimateTokensFromText(repair.rawText);

  if (!parsed.ok) {
    throw new Error(`No se pudo validar JSON tras intento de reparación: ${parsed.error}`);
  }

  return {
    output: parsed.value,
    tokenInput: promptTokens + (repair.usage?.promptTokenCount ?? estimateTokensFromText(repairPrompt)),
    tokenOutput: outputTokens
  };
}

async function buildGenerationContext(request: GenerateRequest): Promise<BuildContextResult> {
  if (request.requestType === "new") {
    return {
      projectRecord: null
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: request.projectId },
    select: { id: true, durationHours: true }
  });

  if (!project) {
    throw new Error("No existe el proyecto indicado para regeneración.");
  }

  let baseVersion = null;
  if (request.baseVersionId) {
    baseVersion = await prisma.version.findFirst({
      where: { id: request.baseVersionId, projectId: request.projectId },
      select: { id: true, responseJson: true }
    });
  }

  if (!baseVersion) {
    baseVersion = await prisma.version.findFirst({
      where: { projectId: request.projectId },
      orderBy: { versionNumber: "desc" },
      select: { id: true, responseJson: true }
    });
  }

  if (!baseVersion) {
    throw new Error("No hay versión base para aplicar edición guiada.");
  }

  return {
    projectRecord: project,
    previousJson: parseStoredJson<unknown>(baseVersion.responseJson, "Version.responseJson"),
    resolvedBaseVersionId: baseVersion.id
  };
}

function buildCacheKey(request: GenerateRequest, context: BuildContextResult, model: string): string {
  const payload = {
    requestType: request.requestType,
    model,
    options: request.options,
    project: request.requestType === "new" ? request.project : undefined,
    projectId: request.requestType === "refine" ? request.projectId : undefined,
    baseVersionId: context.resolvedBaseVersionId,
    editInstruction: request.requestType === "refine" ? request.editInstruction : undefined,
    targetSection: request.requestType === "refine" ? request.targetSection : undefined,
    previousJson: context.previousJson,
    promptVersion: "2026-02-12"
  };

  return sha256(JSON.stringify(payload));
}

async function ensureProjectForRequest(request: GenerateRequest, model: string): Promise<{ id: string; durationHours: number }> {
  if (request.requestType === "new") {
    const project = await prisma.project.create({
      data: {
        name: request.project.name,
        audience: request.project.audience,
        level: request.project.level,
        durationHours: Math.round(request.project.durationHours),
        modality: request.project.modality,
        generalObjectives: request.project.generalObjectives,
        restrictions: request.project.restrictions,
        availableResources: request.project.availableResources,
        pedagogicalApproach: request.project.pedagogicalApproach,
        evaluationApproach: request.project.evaluationApproach,
        language: request.project.language,
        tone: request.project.tone,
        preferredModel: model
      },
      select: { id: true, durationHours: true }
    });

    return project;
  }

  const updated = await prisma.project.update({
    where: { id: request.projectId },
    data: { preferredModel: model },
    select: { id: true, durationHours: true }
  });

  return updated;
}

export async function generateAndStoreVersion(
  request: GenerateRequest,
  hooks?: GenerationHooks
): Promise<GenerateAndStoreResult> {
  await ensureDatabaseReady();

  const model = request.options.model ?? env.GEMINI_MODEL;
  const safetyMode = request.options.safetyMode;

  hooks?.onStage?.("validating", "Preparando contexto de generación.");
  const context = await buildGenerationContext(request);
  const promptUser = buildUserPrompt(request, context.previousJson);
  const cacheKey = buildCacheKey(request, context, model);
  hooks?.onStage?.("cache_lookup", "Verificando si ya existe una respuesta en caché.");

  let response: InstructionalDesignOutput;
  let qualityReport: QualityReport;
  let tokenInput = 0;
  let tokenOutput = 0;
  let estimatedCostUsd = 0;
  let fromCache = false;

  const cacheEntry = await getValidCacheEntry(cacheKey);
  if (cacheEntry) {
    hooks?.onStage?.("cache_hit", "Se reutilizará una respuesta existente en caché.");
    const parsedOutput = InstructionalDesignOutputSchema.parse(
      parseStoredJson<unknown>(cacheEntry.responseJson, "CacheEntry.responseJson")
    );
    response = parsedOutput;
    qualityReport = parseStoredJson<QualityReport>(cacheEntry.qualityReport, "CacheEntry.qualityReport");
    tokenInput = cacheEntry.tokenInput;
    tokenOutput = cacheEntry.tokenOutput;
    estimatedCostUsd = cacheEntry.estimatedCostUsd;
    fromCache = true;
  } else {
    hooks?.onStage?.("cache_miss", "No hay caché. Iniciando generación con IA.");
    const generated = await generateStrictJson({
      model,
      safetyMode,
      userPrompt: promptUser,
      hooks
    });

    response = generated.output;
    tokenInput = generated.tokenInput;
    tokenOutput = generated.tokenOutput;
    estimatedCostUsd = estimateCostUsd(tokenInput, tokenOutput);

    const expectedDurationHours =
      request.requestType === "new"
        ? request.project.durationHours
        : response.project.duration_hours || context.projectRecord?.durationHours || 0;

    hooks?.onStage?.("quality_check", "Ejecutando validaciones internas de calidad.");
    qualityReport = evaluateInstructionalQuality(response, expectedDurationHours);

    await upsertCacheEntry({
      key: cacheKey,
      model,
      safetyMode,
      requestPayload: request,
      responseJson: response,
      qualityReport,
      tokenInput,
      tokenOutput,
      estimatedCostUsd
    });
  }

  hooks?.onStage?.("persisting", "Guardando versión en base de datos.");
  const project = await ensureProjectForRequest(request, model);

  const version = await createVersionRecord({
    projectId: project.id,
    request,
    model,
    promptSystem: SYSTEM_INSTRUCTION,
    promptUser,
    response,
    qualityReport,
    tokenInput,
    tokenOutput,
    estimatedCostUsd,
    cacheKey,
    fromCache
  });

  hooks?.onStage?.("completed", "Generación completada.");
  return {
    projectId: project.id,
    versionId: version.id,
    versionNumber: version.versionNumber,
    response,
    qualityReport,
    tokenInput,
    tokenOutput,
    estimatedCostUsd,
    fromCache,
    cacheKey,
    model
  };
}
