import { describe, expect, it } from "vitest";
import { sampleOutput } from "@/tests/fixtures";
import { toPptxBuffer } from "@/lib/services/pptx-export";

describe("pptx-export", () => {
  it(
    "genera un PPTX (ZIP) válido",
    async () => {
      const buffer = await toPptxBuffer(sampleOutput);

      expect(buffer.byteLength).toBeGreaterThan(1000);
      // PPTX es un ZIP: firma 'PK'
      expect(buffer[0]).toBe(0x50);
      expect(buffer[1]).toBe(0x4b);
    },
    30_000
  );
});

