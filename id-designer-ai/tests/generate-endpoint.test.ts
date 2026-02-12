import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleOutput } from "@/tests/fixtures";

const mocks = vi.hoisted(() => {
  return {
    isAuthenticated: vi.fn(),
    applyRateLimit: vi.fn(),
    generateAndStoreVersion: vi.fn()
  };
});

vi.mock("@/lib/auth/session", () => ({
  isAuthenticated: mocks.isAuthenticated
}));

vi.mock("@/lib/cache/rate-limit", () => ({
  applyRateLimit: mocks.applyRateLimit
}));

vi.mock("@/lib/services/generation-service", () => ({
  generateAndStoreVersion: mocks.generateAndStoreVersion
}));

import { POST } from "@/app/api/generate/route";

describe("POST /api/generate", () => {
  beforeEach(() => {
    mocks.isAuthenticated.mockReturnValue(true);
    mocks.applyRateLimit.mockReturnValue({
      allowed: true,
      remaining: 19,
      resetInSeconds: 60,
      limit: 20
    });

    mocks.generateAndStoreVersion.mockResolvedValue({
      projectId: "project_1",
      versionId: "version_1",
      versionNumber: 1,
      response: sampleOutput,
      qualityReport: {
        overallScore: 90,
        items: [],
        issues: [],
        fixSuggestions: []
      },
      tokenInput: 123,
      tokenOutput: 456,
      estimatedCostUsd: 0.0003,
      fromCache: false,
      cacheKey: "cache_key",
      model: "gemini-2.5-flash"
    });
  });

  it("responde 200 con payload generado", async () => {
    const request = new Request("http://localhost/api/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "id_designer_session=fake"
      },
      body: JSON.stringify({
        requestType: "new",
        project: {
          name: "Curso",
          audience: "Docentes",
          level: "Intermedio",
          durationHours: 10,
          modality: "virtual",
          generalObjectives: "Aplicar estrategias de enseñanza activa en aula virtual.",
          restrictions: "",
          availableResources: "LMS",
          pedagogicalApproach: "ABP",
          evaluationApproach: "Rúbricas",
          language: "español",
          tone: "profesional"
        },
        options: {
          model: "gemini-2.5-flash",
          safetyMode: "normal",
          template: "general",
          mode: "full"
        }
      })
    });

    const response = await POST(request);
    const payload = (await response.json()) as { projectId: string; versionId: string };

    expect(response.status).toBe(200);
    expect(payload.projectId).toBe("project_1");
    expect(payload.versionId).toBe("version_1");
    expect(mocks.generateAndStoreVersion).toHaveBeenCalledTimes(1);
  });
});
