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
      model: "gemini-3-pro"
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
          resourceNumber: "R01",
          resourceName: "Introducción",
          durationHours: 10,
          baseMaterial: {
            filename: "base.txt",
            mimeType: "text/plain",
            content: "Contenido base de ejemplo."
          }
        },
        options: {
          model: "gemini-3-pro",
          safetyMode: "normal",
          template: "general",
          mode: "ova-storyboard"
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
