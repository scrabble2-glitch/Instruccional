import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { sampleOutput } from "@/tests/fixtures";
import { buildDeliveryPackage } from "@/lib/services/delivery-package";

describe("delivery-package", () => {
  it(
    "genera un zip con artefactos de entrega",
    async () => {
      const result = await buildDeliveryPackage({
        baseName: "curso-demo-v1",
        courseName: "Curso demo",
        versionNumber: 1,
        output: sampleOutput,
        qualityReport: {
          overallScore: 87,
          items: [],
          issues: [],
          fixSuggestions: [],
          editorialChecklist: []
        },
        mode: "ova-storyboard",
        model: "gemini-3-pro",
        createdAtIso: "2026-02-17T12:00:00.000Z"
      });

      expect(result.zipBuffer.byteLength).toBeGreaterThan(1000);
      expect(result.artifacts.length).toBeGreaterThanOrEqual(7);

      const zip = await JSZip.loadAsync(result.zipBuffer);
      const files = Object.keys(zip.files);

      expect(files.some((name) => name.endsWith("curso-demo-v1.pptx"))).toBe(true);
      expect(files.some((name) => name.endsWith("curso-demo-v1.json"))).toBe(true);
      expect(files.some((name) => name.endsWith("curso-demo-v1-checklist-qc.md"))).toBe(true);
      expect(files.some((name) => name.endsWith("curso-demo-v1-visuales-licencias.md"))).toBe(true);
    },
    30_000
  );
});
