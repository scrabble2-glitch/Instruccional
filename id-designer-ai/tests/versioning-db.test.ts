import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { SYSTEM_INSTRUCTION } from "@/lib/prompts/system-instruction";
import { createVersionRecord } from "@/lib/services/versioning";
import { sampleOutput } from "@/tests/fixtures";

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Project" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "audience" TEXT NOT NULL,
      "level" TEXT NOT NULL,
      "durationHours" INTEGER NOT NULL,
      "modality" TEXT NOT NULL,
      "generalObjectives" TEXT NOT NULL,
      "restrictions" TEXT,
      "availableResources" TEXT,
      "pedagogicalApproach" TEXT,
      "evaluationApproach" TEXT,
      "language" TEXT NOT NULL DEFAULT 'es',
      "tone" TEXT NOT NULL DEFAULT 'profesional',
      "preferredModel" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Version" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT NOT NULL,
      "versionNumber" INTEGER NOT NULL,
      "promptSystem" TEXT NOT NULL,
      "promptUser" TEXT NOT NULL,
      "generationParams" TEXT NOT NULL,
      "requestPayload" TEXT NOT NULL,
      "responseJson" TEXT NOT NULL,
      "qualityReport" TEXT NOT NULL,
      "tokenInput" INTEGER NOT NULL DEFAULT 0,
      "tokenOutput" INTEGER NOT NULL DEFAULT 0,
      "estimatedCostUsd" REAL NOT NULL DEFAULT 0,
      "cacheKey" TEXT,
      "fromCache" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Version_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "Version_projectId_versionNumber_key" ON "Version"("projectId", "versionNumber")'
  );
});

beforeEach(async () => {
  await prisma.version.deleteMany();
  await prisma.project.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Versionado en DB", () => {
  it("incrementa versionNumber de forma secuencial por proyecto", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Proyecto de prueba",
        audience: "Equipo QA",
        level: "Intermedio",
        durationHours: 6,
        modality: "virtual",
        generalObjectives: "Objetivo general de prueba",
        restrictions: "",
        availableResources: "",
        pedagogicalApproach: "",
        evaluationApproach: "",
        language: "español",
        tone: "profesional",
        preferredModel: "gemini-2.5-flash"
      }
    });

    const requestPayload = {
      requestType: "new" as const,
      project: {
        name: "Proyecto de prueba",
        resourceNumber: "R01",
        resourceName: "Introducción",
        baseMaterialStrategy: "analyze_storyboard",
        audience: "Equipo QA",
        level: "Intermedio",
        durationHours: 6,
        modality: "virtual" as const,
        generalObjectives: "Objetivo general de prueba",
        restrictions: "",
        availableResources: "",
        pedagogicalApproach: "",
        evaluationApproach: "",
        language: "español",
        tone: "profesional"
      },
      options: {
        model: "gemini-2.5-flash",
        safetyMode: "normal" as const,
        template: "general" as const,
        mode: "full" as const
      }
    };

    const first = await createVersionRecord({
      projectId: project.id,
      request: requestPayload,
      model: "gemini-2.5-flash",
      promptSystem: SYSTEM_INSTRUCTION,
      promptUser: "prompt 1",
      response: sampleOutput,
      qualityReport: {
        overallScore: 85,
        items: [],
        issues: [],
        fixSuggestions: []
      },
      tokenInput: 100,
      tokenOutput: 200,
      estimatedCostUsd: 0.0002,
      cacheKey: "k1",
      fromCache: false
    });

    const second = await createVersionRecord({
      projectId: project.id,
      request: requestPayload,
      model: "gemini-2.5-flash",
      promptSystem: SYSTEM_INSTRUCTION,
      promptUser: "prompt 2",
      response: sampleOutput,
      qualityReport: {
        overallScore: 86,
        items: [],
        issues: [],
        fixSuggestions: []
      },
      tokenInput: 110,
      tokenOutput: 220,
      estimatedCostUsd: 0.00025,
      cacheKey: "k2",
      fromCache: true
    });

    expect(first.versionNumber).toBe(1);
    expect(second.versionNumber).toBe(2);

    const versions = await prisma.version.findMany({
      where: { projectId: project.id },
      orderBy: { versionNumber: "asc" }
    });

    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2]);
  });
});
