import { describe, expect, it } from "vitest";
import {
  BASE_MATERIAL_MAX_BYTES,
  BASE_MATERIAL_MAX_OFFICE_BYTES,
  resolveBaseMaterialMaxBytes
} from "@/lib/constants/base-material";

describe("base material limits", () => {
  it("usa límite office para DOCX/PPTX", () => {
    expect(resolveBaseMaterialMaxBytes("curso.pptx", "")).toBe(BASE_MATERIAL_MAX_OFFICE_BYTES);
    expect(resolveBaseMaterialMaxBytes("guion.docx", "application/octet-stream")).toBe(
      BASE_MATERIAL_MAX_OFFICE_BYTES
    );
    expect(
      resolveBaseMaterialMaxBytes(
        "archivo.bin",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe(BASE_MATERIAL_MAX_OFFICE_BYTES);
  });

  it("usa límite general para PDF e imágenes", () => {
    expect(resolveBaseMaterialMaxBytes("material.pdf", "application/pdf")).toBe(BASE_MATERIAL_MAX_BYTES);
    expect(resolveBaseMaterialMaxBytes("imagen.png", "image/png")).toBe(BASE_MATERIAL_MAX_BYTES);
    expect(resolveBaseMaterialMaxBytes("notas.txt", "text/plain")).toBe(BASE_MATERIAL_MAX_BYTES);
  });
});
