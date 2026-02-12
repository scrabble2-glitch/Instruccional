import { prisma } from "@/lib/prisma";
import { serializeJson } from "@/lib/utils/json-store";
import { GenerateRequest } from "@/lib/validators/input";
import { InstructionalDesignOutput } from "@/lib/validators/output-schema";
import { QualityReport } from "@/lib/validators/quality";

interface CreateVersionRecordInput {
  projectId: string;
  request: GenerateRequest;
  model: string;
  promptSystem: string;
  promptUser: string;
  response: InstructionalDesignOutput;
  qualityReport: QualityReport;
  tokenInput: number;
  tokenOutput: number;
  estimatedCostUsd: number;
  cacheKey: string;
  fromCache: boolean;
}

export async function createVersionRecord(
  input: CreateVersionRecordInput
): Promise<{ id: string; versionNumber: number }> {
  return prisma.$transaction(async (tx) => {
    const latest = await tx.version.findFirst({
      where: { projectId: input.projectId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true }
    });

    const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

    return tx.version.create({
      data: {
        projectId: input.projectId,
        versionNumber: nextVersionNumber,
        promptSystem: input.promptSystem,
        promptUser: input.promptUser,
        generationParams: serializeJson({
          model: input.model,
          safetyMode: input.request.options.safetyMode,
          template: input.request.options.template,
          mode: input.request.options.mode,
          targetSection: input.request.requestType === "refine" ? input.request.targetSection : "all"
        }),
        requestPayload: serializeJson(input.request),
        responseJson: serializeJson(input.response),
        qualityReport: serializeJson(input.qualityReport),
        tokenInput: input.tokenInput,
        tokenOutput: input.tokenOutput,
        estimatedCostUsd: input.estimatedCostUsd,
        cacheKey: input.cacheKey,
        fromCache: input.fromCache
      },
      select: {
        id: true,
        versionNumber: true
      }
    });
  });
}
