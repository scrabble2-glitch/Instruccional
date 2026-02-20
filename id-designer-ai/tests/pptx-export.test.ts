import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { sampleOutput } from "@/tests/fixtures";
import { toPptxBuffer } from "@/lib/services/pptx-export";

describe("pptx-export", () => {
  it(
    "genera un PPTX (ZIP) válido",
    async () => {
      const buffer = await toPptxBuffer(sampleOutput, { mode: "ova-storyboard" });

      expect(buffer.byteLength).toBeGreaterThan(1000);
      // PPTX es un ZIP: firma 'PK'
      expect(buffer[0]).toBe(0x50);
      expect(buffer[1]).toBe(0x4b);

      const zip = await JSZip.loadAsync(buffer);
      const slideEntries = Object.keys(zip.files).filter((name) => name.startsWith("ppt/slides/slide") && name.endsWith(".xml"));
      const xmlJoined = (
        await Promise.all(
          slideEntries.map(async (entry) => {
            const file = zip.file(entry);
            return file ? await file.async("text") : "";
          })
        )
      ).join("\n");

      // Guard against numeric overflow in shadow conversion (can trigger "PowerPoint repaired this file").
      const blurValues = Array.from(xmlJoined.matchAll(/blurRad="(\d+)"/g)).map((match) => Number(match[1]));
      const distValues = Array.from(xmlJoined.matchAll(/dist="(\d+)"/g)).map((match) => Number(match[1]));
      expect(blurValues.every((value) => Number.isFinite(value) && value <= 2_000_000)).toBe(true);
      expect(distValues.every((value) => Number.isFinite(value) && value <= 2_000_000)).toBe(true);
    },
    30_000
  );
});
