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

import { POST } from "@/app/api/generate/stream/route";

describe("POST /api/generate/stream", () => {
  beforeEach(() => {
    mocks.isAuthenticated.mockReturnValue(true);
    mocks.applyRateLimit.mockReturnValue({
      allowed: true,
      remaining: 19,
      resetInSeconds: 60,
      limit: 20
    });

    mocks.generateAndStoreVersion.mockImplementation(async (_request, hooks) => {
      hooks?.onStage?.("validating", "Preparando contexto de generación.");
      hooks?.onStage?.("completed", "Generación completada.");

      return {
        projectId: "project_stream",
        versionId: "version_stream",
        versionNumber: 1,
        response: sampleOutput,
        qualityReport: {
          overallScore: 90,
          items: [],
          issues: [],
          fixSuggestions: []
        },
        tokenInput: 111,
        tokenOutput: 222,
        estimatedCostUsd: 0.000333,
        fromCache: false,
        cacheKey: "stream_cache_key",
        model: "gemini-2.5-flash"
      };
    });
  });

  it("emite eventos SSE de progreso y finalización", async () => {
    const request = new Request("http://localhost/api/generate/stream", {
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
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: status");
    expect(body).toContain("event: complete");
    expect(body).toContain("project_stream");
  });
});
