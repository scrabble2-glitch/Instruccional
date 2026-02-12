import { describe, expect, it } from "vitest";
import { sampleOutput } from "@/tests/fixtures";
import { InstructionalDesignOutputSchema } from "@/lib/validators/output-schema";

describe("InstructionalDesignOutputSchema", () => {
  it("acepta un payload válido", () => {
    const parsed = InstructionalDesignOutputSchema.parse(sampleOutput);
    expect(parsed.project.title).toBe("Curso de liderazgo");
  });

  it("rechaza payload inválido", () => {
    const invalid = {
      ...sampleOutput,
      project: {
        ...sampleOutput.project,
        title: ""
      }
    };

    const result = InstructionalDesignOutputSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
