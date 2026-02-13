import PptxGenJS from "pptxgenjs";
import type { InstructionalDesignOutput } from "@/lib/validators/output-schema";

export type PptxExportMode = "full" | "evaluation-only" | "ova-storyboard";

const COLOR = {
  accent: "0B7285",
  slate900: "0F172A",
  slate700: "334155",
  slate500: "64748B",
  border: "CBD5E1",
  panel: "F8FAFC",
  white: "FFFFFF"
} as const;

function safeLine(text: string): string {
  // Keep PPTX text clean: no tabs and avoid accidental control characters.
  return text.replaceAll("\t", " ").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").trim();
}

function bulletLines(lines: string[], maxItems?: number): string {
  const cleaned = lines.map(safeLine).filter(Boolean);
  if (!cleaned.length) return "N/D";

  if (typeof maxItems === "number" && cleaned.length > maxItems) {
    return [...cleaned.slice(0, maxItems), `(+${cleaned.length - maxItems} más)`].join("\n");
  }

  return cleaned.join("\n");
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out.length ? out : [[]];
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function toCourseSummary(output: InstructionalDesignOutput): string[] {
  return [
    `Audiencia: ${output.project.audience}`,
    `Nivel: ${output.project.level}`,
    `Duración: ${output.project.duration_hours} horas`,
    `Modalidad: ${output.project.modality}`,
    `Modelo: ${output.instructional_model.approach}`
  ];
}

function formatActivity(activity: InstructionalDesignOutput["course_structure"][number]["learning_activities"][number]): string {
  const core = `${activity.type} (${activity.modality}, ${activity.estimated_minutes} min): ${activity.description}`;
  return safeLine(core);
}

function formatAssessment(
  assessment: InstructionalDesignOutput["course_structure"][number]["assessment"][number]
): string {
  const rubricTop = assessment.rubric?.[0]?.criterion ? ` | Rúbrica: ${assessment.rubric[0].criterion}` : "";
  return safeLine(`${assessment.type}: ${assessment.description} | Evidencia: ${assessment.evidence}${rubricTop}`);
}

function formatResource(resource: InstructionalDesignOutput["course_structure"][number]["resources"][number]): string {
  const link = resource.link_optional?.trim() ? ` (${resource.link_optional.trim()})` : "";
  return safeLine(`${resource.type}: ${resource.title}${link}`);
}

function addHeader(slide: PptxGenJS.Slide, title: string, subtitle?: string) {
  // PptxGenJS expects literal shape names in node runtimes (do not rely on exported enums).
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 13.33,
    h: 0.85,
    fill: { color: COLOR.accent }
  });

  slide.addText(safeLine(title), {
    x: 0.6,
    y: 0.15,
    w: 12.2,
    h: 0.5,
    fontFace: "Calibri",
    fontSize: 22,
    bold: true,
    color: COLOR.white
  });

  if (subtitle?.trim()) {
    slide.addText(safeLine(subtitle), {
      x: 0.6,
      y: 0.58,
      w: 12.2,
      h: 0.25,
      fontFace: "Calibri",
      fontSize: 12,
      color: "E2E8F0"
    });
  }
}

function addPanel(
  slide: PptxGenJS.Slide,
  params: { title: string; body: string; x: number; y: number; w: number; h: number; bullet?: boolean }
) {
  slide.addShape("roundRect", {
    x: params.x,
    y: params.y,
    w: params.w,
    h: params.h,
    fill: { color: COLOR.panel },
    line: { color: COLOR.border, width: 1 }
  });

  slide.addText(safeLine(params.title), {
    x: params.x + 0.25,
    y: params.y + 0.15,
    w: params.w - 0.5,
    h: 0.3,
    fontFace: "Calibri",
    fontSize: 12,
    bold: true,
    color: COLOR.slate900
  });

  slide.addText(params.body, {
    x: params.x + 0.25,
    y: params.y + 0.48,
    w: params.w - 0.5,
    h: params.h - 0.65,
    fontFace: "Calibri",
    fontSize: 11,
    color: COLOR.slate700,
    valign: "top",
    bullet: params.bullet ?? true
  });
}

async function toNodeBuffer(pptx: PptxGenJS): Promise<Buffer> {
  const content = await pptx.write({ outputType: "nodebuffer" });

  if (typeof content === "string") {
    // Should not happen for nodebuffer, but keep it safe.
    return Buffer.from(content, "binary");
  }

  if (content instanceof ArrayBuffer) {
    return Buffer.from(content);
  }

  // Node returns Uint8Array (Buffer is a Uint8Array).
  if (content && typeof content === "object" && "byteLength" in content) {
    return Buffer.from(content as Uint8Array);
  }

  throw new Error("No fue posible generar el PPTX en formato binario.");
}

type CourseUnit = InstructionalDesignOutput["course_structure"][number];

function pickSpecialResource(unit: CourseUnit, patterns: RegExp[]): string | null {
  for (const resource of unit.resources) {
    const key = normalizeKey(resource.type || "");
    if (patterns.some((pattern) => pattern.test(key))) {
      const value = resource.title?.trim();
      if (value) return value;
    }
  }
  return null;
}

function otherResources(unit: CourseUnit): CourseUnit["resources"] {
  return unit.resources.filter((resource) => {
    const key = normalizeKey(resource.type || "");
    return !/(guion_audio|audio|narracion|locucion|notas_construccion|construccion|build)/.test(key);
  });
}

function buildNotes(params: {
  courseTitle: string;
  unit: CourseUnit;
  audioScript: string | null;
  buildNotes: string | null;
  extraResources: string[];
}): string {
  const lines: string[] = [];

  lines.push(`Curso: ${safeLine(params.courseTitle)}`);
  lines.push(`Pantalla: ${safeLine(`${params.unit.unit_id} - ${params.unit.title}`)}`);
  lines.push(`Duración estimada: ${params.unit.duration_minutes} min`);
  lines.push("");

  lines.push("GUION DE AUDIO:");
  lines.push(params.audioScript?.trim() ? params.audioScript.trim() : "(No provisto por IA. Regenera para completar.)");
  lines.push("");

  lines.push("NOTAS DE CONSTRUCCION:");
  lines.push(params.buildNotes?.trim() ? params.buildNotes.trim() : "(No provistas por IA. Regenera para completar.)");
  lines.push("");

  if (params.extraResources.length) {
    lines.push("RECURSOS / ASSETS (placeholders):");
    for (const resource of params.extraResources) {
      lines.push(`- ${resource}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildInteractivityLines(unit: CourseUnit): string[] {
  const lines: string[] = [];

  for (const activity of unit.learning_activities) {
    const label = `${activity.type}: ${activity.description}`;
    lines.push(safeLine(label));
  }

  for (const assessment of unit.assessment) {
    const label = `Check (${assessment.type}): ${assessment.description} | Evidencia: ${assessment.evidence}`;
    lines.push(safeLine(label));
  }

  return lines.length ? lines : ["Sin interactividad declarada (agrega instrucciones para estudiantes)."];
}

function addStoryboardCover(pptx: PptxGenJS, output: InstructionalDesignOutput) {
  const slide = pptx.addSlide();
  addHeader(slide, output.project.title, "Guion técnico instruccional (Storyboard OVA)");

  slide.addShape("roundRect", {
    x: 4.9,
    y: 3.2,
    w: 3.6,
    h: 0.9,
    fill: { color: COLOR.white },
    line: { color: COLOR.border, width: 1 }
  });
  slide.addText("Iniciar", {
    x: 4.9,
    y: 3.28,
    w: 3.6,
    h: 0.9,
    align: "center",
    valign: "middle",
    fontFace: "Calibri",
    fontSize: 20,
    bold: true,
    color: COLOR.accent
  });

  slide.addText(
    "Este PPTX es un guion técnico para producción. El texto visible corresponde al estudiante; el audio y notas de construcción van en Notas del orador.",
    {
      x: 0.9,
      y: 5.9,
      w: 11.6,
      h: 1.0,
      fontFace: "Calibri",
      fontSize: 12,
      color: COLOR.slate700
    }
  );

  slide.addNotes(
    [
      `Curso: ${safeLine(output.project.title)}`,
      "",
      "NOTAS DE CONSTRUCCION:",
      "- Botón 'Iniciar': navegar a la pantalla de Contenido/Menú.",
      "- Mantener estilo y navegación consistente en todas las pantallas (Menú/Atrás).",
      "",
      "GUION DE AUDIO:",
      "Bienvenido/a. En este recurso recorrerás el contenido de forma guiada. Usa el menú para avanzar por las secciones y realiza las actividades para consolidar tu aprendizaje."
    ].join("\n")
  );
}

function addStoryboardMenu(pptx: PptxGenJS, output: InstructionalDesignOutput) {
  const slide = pptx.addSlide();
  addHeader(slide, "Contenido", "Haz clic en cada botón para acceder a la información");

  const items = output.course_structure.map((unit) => `${unit.unit_id}. ${unit.title}`);
  addPanel(slide, {
    title: "Pantallas",
    body: bulletLines(items, 18),
    x: 0.9,
    y: 1.4,
    w: 11.55,
    h: 5.6,
    bullet: true
  });

  slide.addNotes(
    [
      `Curso: ${safeLine(output.project.title)}`,
      "",
      "NOTAS DE CONSTRUCCION:",
      "- Construir un menú con botones a cada pantalla (unit_id).",
      "- Agregar botón 'Anterior' y botón 'Menú' persistentes.",
      "- Al visitar una pantalla, marcar el botón correspondiente con un check/estado para orientar la navegación.",
      "",
      "GUION DE AUDIO:",
      "Selecciona una sección del menú para iniciar. Puedes regresar al menú en cualquier momento para retomar otra pantalla."
    ].join("\n")
  );
}

async function toPptxBufferStoryboard(output: InstructionalDesignOutput): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Instructional Design Designer AI";
  pptx.company = "id-designer-ai";
  pptx.subject = "Guion técnico instruccional (Storyboard OVA)";
  pptx.title = safeLine(output.project.title);

  addStoryboardCover(pptx, output);
  addStoryboardMenu(pptx, output);

  for (const unit of output.course_structure) {
    const audioScript = pickSpecialResource(unit, [/^guion_audio$/, /audio/, /narracion/, /locucion/]);
    const build = pickSpecialResource(unit, [/^notas_construccion$/, /construccion/, /build/]);
    const resources = otherResources(unit).map(formatResource);
    const interactivity = buildInteractivityLines(unit);

    const contentChunks = chunk(unit.content_outline, 14);
    for (let idx = 0; idx < contentChunks.length; idx += 1) {
      const slide = pptx.addSlide();
      const partLabel = contentChunks.length > 1 ? ` (parte ${idx + 1}/${contentChunks.length})` : "";
      addHeader(slide, `${unit.unit_id} — ${unit.title}${partLabel}`, `Duración: ${unit.duration_minutes} min`);

      addPanel(slide, {
        title: "Texto en pantalla (estudiante)",
        body: bulletLines(contentChunks[idx]),
        x: 0.9,
        y: 1.25,
        w: 7.55,
        h: 5.85,
        bullet: false
      });

      addPanel(slide, {
        title: "Interactividad (estudiante)",
        body: bulletLines(interactivity, 10),
        x: 8.65,
        y: 1.25,
        w: 3.8,
        h: 2.55,
        bullet: true
      });

      addPanel(slide, {
        title: "Recursos (placeholders)",
        body: bulletLines(resources, 8),
        x: 8.65,
        y: 3.9,
        w: 3.8,
        h: 3.2,
        bullet: true
      });

      const notes = buildNotes({
        courseTitle: output.project.title,
        unit,
        audioScript,
        buildNotes: build,
        extraResources: resources
      });
      slide.addNotes(notes);
    }
  }

  return toNodeBuffer(pptx);
}

async function toPptxBufferOverview(output: InstructionalDesignOutput): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Instructional Design Designer AI";
  pptx.company = "id-designer-ai";
  pptx.subject = "Guion técnico instruccional";
  pptx.title = safeLine(output.project.title);

  // Slide 1: portada
  {
    const slide = pptx.addSlide();
    addHeader(slide, output.project.title, "Guion técnico instruccional (IA) — salida estructurada");

    addPanel(slide, {
      title: "Resumen del curso",
      body: bulletLines(toCourseSummary(output)),
      x: 0.8,
      y: 1.4,
      w: 5.9,
      h: 4.4
    });

    addPanel(slide, {
      title: "Notas ADDIE",
      body: bulletLines([output.instructional_model.notes]),
      x: 7.0,
      y: 1.4,
      w: 5.5,
      h: 4.4
    });

    slide.addText("Exportable para producción/LMS. Recursos con placeholders; no se incluyen links inventados.", {
      x: 0.8,
      y: 6.2,
      w: 11.9,
      h: 0.4,
      fontFace: "Calibri",
      fontSize: 10,
      color: COLOR.slate500
    });
  }

  // Slide 2: resultados de aprendizaje
  {
    const slide = pptx.addSlide();
    addHeader(slide, "Resultados de aprendizaje (Bloom)", `${output.learning_outcomes.length} outcomes`);

    const lines = output.learning_outcomes.map((lo) => `${lo.id} (${lo.bloom_level}): ${lo.statement}`);
    addPanel(slide, {
      title: "Outcomes",
      body: bulletLines(lines),
      x: 0.8,
      y: 1.25,
      w: 11.75,
      h: 5.9
    });
  }

  // Slides por unidad (storyboard / estructura)
  for (const unit of output.course_structure) {
    const contentChunks = chunk(unit.content_outline, 10);

    for (let idx = 0; idx < contentChunks.length; idx += 1) {
      const slide = pptx.addSlide();
      const partLabel = contentChunks.length > 1 ? ` (Guion ${idx + 1}/${contentChunks.length})` : "";
      addHeader(
        slide,
        `${unit.unit_id} — ${unit.title}${partLabel}`,
        `Duración: ${unit.duration_minutes} min | Outcomes: ${unit.outcomes.join(", ")}`
      );

      addPanel(slide, {
        title: "Propósito",
        body: bulletLines([unit.purpose]),
        x: 0.8,
        y: 1.15,
        w: 11.75,
        h: 1.15
      });

      addPanel(slide, {
        title: "Guion / contenidos (editable)",
        body: bulletLines(contentChunks[idx]),
        x: 0.8,
        y: 2.45,
        w: 6.0,
        h: 4.65
      });

      addPanel(slide, {
        title: "Actividades (interacción)",
        body: bulletLines(unit.learning_activities.map(formatActivity), 8),
        x: 7.0,
        y: 2.45,
        w: 5.55,
        h: 1.75
      });

      addPanel(slide, {
        title: "Evaluación",
        body: bulletLines(unit.assessment.map(formatAssessment), 6),
        x: 7.0,
        y: 4.35,
        w: 5.55,
        h: 1.75
      });

      addPanel(slide, {
        title: "Recursos (placeholders)",
        body: bulletLines(unit.resources.map(formatResource), 6),
        x: 7.0,
        y: 6.25,
        w: 5.55,
        h: 0.85
      });
    }
  }

  // Matriz de alineación (resumen)
  {
    const slide = pptx.addSlide();
    addHeader(slide, "Matriz de alineación (resumen)", "Objetivo ↔ Actividad ↔ Evaluación");

    const lines = output.alignment_matrix.map((row) => {
      const issues = row.issues.length ? ` | Issues: ${row.issues.join("; ")}` : "";
      return `${row.outcome_id}: ${row.alignment_score_0_100}/100${issues}`;
    });

    addPanel(slide, {
      title: "Alineación por outcome",
      body: bulletLines(lines),
      x: 0.8,
      y: 1.25,
      w: 11.75,
      h: 5.9
    });
  }

  // Notas de producción
  {
    const slide = pptx.addSlide();
    addHeader(slide, "Notas de producción", "Para implementación en LMS + accesibilidad");

    addPanel(slide, {
      title: "Para LMS",
      body: bulletLines(output.production_notes.for_lms, 12),
      x: 0.8,
      y: 1.25,
      w: 5.75,
      h: 2.8
    });

    addPanel(slide, {
      title: "Accesibilidad",
      body: bulletLines(output.production_notes.accessibility, 12),
      x: 6.9,
      y: 1.25,
      w: 5.65,
      h: 2.8
    });

    addPanel(slide, {
      title: "Riesgos / preguntas",
      body: bulletLines(output.production_notes.risks, 14),
      x: 0.8,
      y: 4.25,
      w: 11.75,
      h: 2.9
    });
  }

  return toNodeBuffer(pptx);
}

export async function toPptxBuffer(
  output: InstructionalDesignOutput,
  options?: { mode?: string }
): Promise<Buffer> {
  const mode = (options?.mode ?? "full") as string;
  if (mode === "ova-storyboard") {
    return toPptxBufferStoryboard(output);
  }
  return toPptxBufferOverview(output);
}
