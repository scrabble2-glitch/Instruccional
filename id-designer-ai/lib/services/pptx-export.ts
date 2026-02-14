import PptxGenJS from "pptxgenjs";
import type { InstructionalDesignOutput } from "@/lib/validators/output-schema";
import { resolveFreepikVisual, type ResolvedVisual } from "@/lib/services/storyboard-visuals";

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

function pickResourceByType(unit: CourseUnit, type: string): string | null {
  const wanted = normalizeKey(type);
  const found = unit.resources.find((resource) => normalizeKey(resource.type || "") === wanted);
  const value = found?.title?.trim();
  return value && value.length ? value : null;
}

function otherResources(unit: CourseUnit): CourseUnit["resources"] {
  return unit.resources.filter((resource) => {
    const key = normalizeKey(resource.type || "");
    return key !== "guion_audio" && key !== "notas_construccion" && key !== "imagen_query";
  });
}

function buildNotes(params: {
  courseTitle: string;
  unit: CourseUnit;
  audioScript: string | null;
  buildNotes: string | null;
  studentText: string[];
  interactivity: string[];
  visualQuery: string | null;
  visualAttribution: string[];
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

  lines.push("TEXTO EN PANTALLA (completo):");
  lines.push(bulletLines(params.studentText, 80));
  lines.push("");

  lines.push("INTERACTIVIDAD (completa):");
  lines.push(bulletLines(params.interactivity, 60));
  lines.push("");

  lines.push("VISUAL / IMAGEN (Freepik):");
  lines.push(`Query: ${params.visualQuery?.trim() ? safeLine(params.visualQuery) : "N/D (se usó fallback automático)"}`);
  if (params.visualAttribution.length) {
    for (const line of params.visualAttribution) lines.push(safeLine(line));
  } else {
    lines.push("(Sin imagen incrustada: configura FREEPIK_API_KEY o revisa el término.)");
  }
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

const STORY = {
  bg: "F1F5F9",
  ink: "0F172A",
  muted: "334155",
  card: "FFFFFF",
  soft: "E2E8F0",
  accent: COLOR.accent,
  accent2: "0EA5E9"
} as const;

function truncateText(text: string, maxChars: number): string {
  const cleaned = safeLine(text);
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function clampLines(lines: string[], maxLines: number, maxLineChars: number): string[] {
  const cleaned = lines.map(safeLine).filter(Boolean).map((line) => truncateText(line, maxLineChars));
  if (cleaned.length <= maxLines) return cleaned;
  return [...cleaned.slice(0, maxLines - 1), `(+${cleaned.length - (maxLines - 1)} más)`];
}

function addStoryBackground(slide: PptxGenJS.Slide) {
  slide.addShape("rect", { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: STORY.bg } });
  slide.addShape("ellipse", {
    x: -1.1,
    y: -0.7,
    w: 3.0,
    h: 3.0,
    fill: { color: STORY.accent2, transparency: 85 },
    line: { color: STORY.accent2, transparency: 100 }
  });
  slide.addShape("ellipse", {
    x: 11.4,
    y: 5.6,
    w: 3.2,
    h: 3.2,
    fill: { color: STORY.accent, transparency: 88 },
    line: { color: STORY.accent, transparency: 100 }
  });
}

function addStoryTopBar(slide: PptxGenJS.Slide, params: { left: string; right?: string }) {
  slide.addShape("rect", { x: 0, y: 0, w: 13.33, h: 0.6, fill: { color: STORY.ink } });
  slide.addText(truncateText(params.left, 90), {
    x: 0.7,
    y: 0.15,
    w: 9.5,
    h: 0.3,
    fontFace: "Calibri",
    fontSize: 12,
    color: STORY.card
  });
  if (params.right?.trim()) {
    slide.addShape("roundRect", {
      x: 11.1,
      y: 0.13,
      w: 1.95,
      h: 0.34,
      fill: { color: STORY.accent }
    });
    slide.addText(truncateText(params.right, 18), {
      x: 11.1,
      y: 0.15,
      w: 1.95,
      h: 0.3,
      align: "center",
      valign: "middle",
      fontFace: "Calibri",
      fontSize: 11,
      bold: true,
      color: STORY.card
    });
  }
}

function addStoryFooterNav(slide: PptxGenJS.Slide) {
  const y = 6.92;
  const btn = (x: number, label: string) => {
    slide.addShape("roundRect", {
      x,
      y,
      w: 1.6,
      h: 0.42,
      fill: { color: STORY.card },
      line: { color: STORY.soft, width: 1 }
    });
    slide.addText(label, {
      x,
      y: y + 0.03,
      w: 1.6,
      h: 0.36,
      align: "center",
      valign: "middle",
      fontFace: "Calibri",
      fontSize: 11,
      color: STORY.muted
    });
  };
  btn(0.7, "Menu");
  btn(2.45, "Atras");
  btn(4.2, "Siguiente");
}

function addStoryboardCover(pptx: PptxGenJS, output: InstructionalDesignOutput, visual: ResolvedVisual | null) {
  const slide = pptx.addSlide();
  addStoryBackground(slide);
  addStoryTopBar(slide, { left: output.project.title, right: "PORTADA" });

  if (visual?.imagePath) {
    slide.addShape("roundRect", {
      x: 7.15,
      y: 0.75,
      w: 5.48,
      h: 6.05,
      fill: { color: STORY.card },
      line: { color: STORY.soft, width: 1 }
    });
    slide.addImage({
      path: visual.imagePath,
      x: 7.2,
      y: 0.8,
      w: 5.38,
      h: 5.95,
      sizing: { type: "cover", w: 5.38, h: 5.95 }
    });
  } else {
    slide.addShape("roundRect", {
      x: 7.15,
      y: 0.75,
      w: 5.48,
      h: 6.05,
      fill: { color: STORY.soft },
      line: { color: STORY.soft, width: 1 }
    });
  }

  slide.addShape("roundRect", {
    x: 0.7,
    y: 0.95,
    w: 6.25,
    h: 3.3,
    fill: { color: STORY.card },
    line: { color: STORY.soft, width: 1 }
  });

  slide.addText("Guion tecnico instruccional", {
    x: 1.0,
    y: 1.15,
    w: 5.7,
    h: 0.4,
    fontFace: "Calibri",
    fontSize: 26,
    bold: true,
    color: STORY.ink
  });
  slide.addText("Storyboard OVA listo para produccion (formato PPTX)", {
    x: 1.0,
    y: 1.6,
    w: 5.7,
    h: 0.35,
    fontFace: "Calibri",
    fontSize: 12,
    color: STORY.muted
  });

  slide.addShape("roundRect", {
    x: 1.0,
    y: 2.25,
    w: 3.2,
    h: 0.8,
    fill: { color: STORY.accent }
  });
  slide.addText("Iniciar", {
    x: 1.0,
    y: 2.32,
    w: 3.2,
    h: 0.65,
    align: "center",
    valign: "middle",
    fontFace: "Calibri",
    fontSize: 20,
    bold: true,
    color: STORY.card
  });

  slide.addText(
    "Texto visible: estudiante. Guion de audio + notas de construccion: Notas del orador. Mantener poco texto por pantalla y priorizar elementos visuales.",
    {
      x: 0.75,
      y: 4.55,
      w: 11.9,
      h: 1.1,
      fontFace: "Calibri",
      fontSize: 11,
      color: STORY.muted
    }
  );

  slide.addNotes(
    [
      `Curso: ${safeLine(output.project.title)}`,
      "",
      "NOTAS DE CONSTRUCCION:",
      "- Boton 'Iniciar': navegar a la pantalla de Contenido/MENU.",
      "- Mantener estilo y navegacion consistente en todas las pantallas (Menu/Atras/Siguiente).",
      "",
      "GUION DE AUDIO:",
      "Bienvenido/a. En este recurso recorreremos el contenido de forma guiada. Usa el menu para avanzar por las secciones y realiza las actividades para consolidar tu aprendizaje.",
      "",
      ...(visual?.attributionLines?.length ? ["VISUAL / IMAGEN:", ...visual.attributionLines] : [])
    ].join("\n")
  );
}

function addStoryboardMenu(pptx: PptxGenJS, output: InstructionalDesignOutput, visual: ResolvedVisual | null) {
  const slide = pptx.addSlide();
  addStoryBackground(slide);
  addStoryTopBar(slide, { left: output.project.title, right: "MENU" });

  slide.addShape("roundRect", {
    x: 0.7,
    y: 0.85,
    w: 6.25,
    h: 5.8,
    fill: { color: STORY.card },
    line: { color: STORY.soft, width: 1 }
  });

  slide.addText("Contenido", {
    x: 1.0,
    y: 1.05,
    w: 5.7,
    h: 0.4,
    fontFace: "Calibri",
    fontSize: 22,
    bold: true,
    color: STORY.ink
  });
  slide.addText("Haz clic en cada boton para acceder a la pantalla.", {
    x: 1.0,
    y: 1.45,
    w: 5.7,
    h: 0.3,
    fontFace: "Calibri",
    fontSize: 11,
    color: STORY.muted
  });

  const items = output.course_structure.map((unit) => `${unit.unit_id}. ${unit.title}`);
  slide.addText(bulletLines(items, 18), {
    x: 1.0,
    y: 1.85,
    w: 5.8,
    h: 4.55,
    fontFace: "Calibri",
    fontSize: 13,
    color: STORY.ink,
    valign: "top",
    bullet: true
  });

  // Visual panel (right)
  if (visual?.imagePath) {
    slide.addShape("roundRect", {
      x: 7.15,
      y: 0.85,
      w: 5.48,
      h: 5.8,
      fill: { color: STORY.card },
      line: { color: STORY.soft, width: 1 }
    });
    slide.addImage({
      path: visual.imagePath,
      x: 7.2,
      y: 0.9,
      w: 5.38,
      h: 5.7,
      sizing: { type: "cover", w: 5.38, h: 5.7 }
    });
  } else {
    slide.addShape("roundRect", {
      x: 7.15,
      y: 0.85,
      w: 5.48,
      h: 5.8,
      fill: { color: STORY.soft },
      line: { color: STORY.soft, width: 1 }
    });
  }

  addStoryFooterNav(slide);

  slide.addNotes(
    [
      `Curso: ${safeLine(output.project.title)}`,
      "",
      "NOTAS DE CONSTRUCCION:",
      "- Construir un menu con botones a cada pantalla (unit_id).",
      "- Agregar boton 'Atras' y boton 'Menu' persistentes.",
      "- Al visitar una pantalla, marcar el boton correspondiente con un check/estado para orientar la navegacion.",
      "",
      "GUION DE AUDIO:",
      "Selecciona una seccion del menu para iniciar. Puedes regresar al menu en cualquier momento para retomar otra pantalla.",
      "",
      ...(visual?.attributionLines?.length ? ["VISUAL / IMAGEN:", ...visual.attributionLines] : [])
    ].join("\n")
  );
}

async function toPptxBufferStoryboard(
  output: InstructionalDesignOutput,
  options?: { courseName?: string }
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Instructional Design Designer AI";
  pptx.company = "id-designer-ai";
  pptx.subject = "Guion técnico instruccional (Storyboard OVA)";
  pptx.title = safeLine(output.project.title);

  const courseName = options?.courseName?.trim().length ? options.courseName.trim() : output.project.title;
  const coverQuery = `${courseName} educacion digital ilustracion`;
  const coverVisual = await resolveFreepikVisual({ courseName, term: coverQuery, preferHorizontal: true });

  addStoryboardCover(pptx, output, coverVisual);
  addStoryboardMenu(pptx, output, coverVisual);

  for (const unit of output.course_structure) {
    const audioScript = pickResourceByType(unit, "guion_audio");
    const build = pickResourceByType(unit, "notas_construccion");
    const visualQuery =
      pickResourceByType(unit, "imagen_query")?.trim() || `${unit.title} ilustracion plana`;
    const visual = await resolveFreepikVisual({ courseName, term: visualQuery, preferHorizontal: true });
    const resources = otherResources(unit).map(formatResource);
    const interactivity = buildInteractivityLines(unit);

    const slide = pptx.addSlide();
    addStoryBackground(slide);
    addStoryTopBar(slide, { left: `${unit.unit_id} - ${unit.title}`, right: unit.unit_id });

    // Left content card
    slide.addShape("roundRect", {
      x: 0.7,
      y: 0.75,
      w: 6.3,
      h: 5.85,
      fill: { color: STORY.card },
      line: { color: STORY.soft, width: 1 }
    });

    slide.addText(truncateText(unit.title, 60), {
      x: 1.0,
      y: 0.95,
      w: 5.8,
      h: 0.35,
      fontFace: "Calibri",
      fontSize: 20,
      bold: true,
      color: STORY.ink
    });

    slide.addText(truncateText(unit.purpose, 140), {
      x: 1.0,
      y: 1.32,
      w: 5.8,
      h: 0.45,
      fontFace: "Calibri",
      fontSize: 11,
      color: STORY.muted
    });

    slide.addText("En pantalla (estudiante)", {
      x: 1.0,
      y: 1.75,
      w: 5.8,
      h: 0.25,
      fontFace: "Calibri",
      fontSize: 12,
      bold: true,
      color: STORY.accent
    });

    const studentLines = clampLines(unit.content_outline, 6, 95);
    slide.addText(studentLines.join("\n"), {
      x: 1.0,
      y: 2.05,
      w: 5.8,
      h: 2.75,
      fontFace: "Calibri",
      fontSize: 16,
      color: STORY.ink,
      valign: "top",
      bullet: true
    });

    // Interactivity card
    slide.addShape("roundRect", {
      x: 1.0,
      y: 4.95,
      w: 5.8,
      h: 1.55,
      fill: { color: "ECFEFF" },
      line: { color: "A5F3FC", width: 1 }
    });
    slide.addText("Interactividad", {
      x: 1.2,
      y: 5.08,
      w: 5.4,
      h: 0.25,
      fontFace: "Calibri",
      fontSize: 12,
      bold: true,
      color: STORY.ink
    });
    const interLines = clampLines(interactivity, 4, 110);
    slide.addText(interLines.join("\n"), {
      x: 1.2,
      y: 5.35,
      w: 5.4,
      h: 1.1,
      fontFace: "Calibri",
      fontSize: 11,
      color: STORY.muted,
      valign: "top",
      bullet: true
    });

    // Right visual card
    slide.addShape("roundRect", {
      x: 7.15,
      y: 0.75,
      w: 5.48,
      h: 5.85,
      fill: { color: STORY.card },
      line: { color: STORY.soft, width: 1 }
    });
    if (visual?.imagePath) {
      slide.addImage({
        path: visual.imagePath,
        x: 7.2,
        y: 0.8,
        w: 5.38,
        h: 5.75,
        sizing: { type: "cover", w: 5.38, h: 5.75 }
      });
    } else {
      slide.addShape("rect", {
        x: 7.2,
        y: 0.8,
        w: 5.38,
        h: 5.75,
        fill: { color: STORY.soft }
      });
      slide.addShape("ellipse", {
        x: 9.1,
        y: 2.1,
        w: 1.9,
        h: 1.9,
        fill: { color: STORY.accent2, transparency: 80 },
        line: { color: STORY.accent2, transparency: 100 }
      });
      slide.addShape("ellipse", {
        x: 8.1,
        y: 3.4,
        w: 2.6,
        h: 2.6,
        fill: { color: STORY.accent, transparency: 88 },
        line: { color: STORY.accent, transparency: 100 }
      });
    }

    // Footer: navigation + resource chips
    addStoryFooterNav(slide);
    const chipSources = otherResources(unit).slice(0, 3).map((res) => safeLine(res.type || "recurso"));
    slide.addText("Recursos:", {
      x: 6.05,
      y: 6.98,
      w: 1.0,
      h: 0.3,
      fontFace: "Calibri",
      fontSize: 10,
      color: STORY.muted
    });
    let chipX = 6.95;
    for (const chip of chipSources) {
      const label = truncateText(chip, 14);
      slide.addShape("roundRect", {
        x: chipX,
        y: 6.92,
        w: 1.55,
        h: 0.42,
        fill: { color: "E0F2FE" },
        line: { color: "BAE6FD", width: 1 }
      });
      slide.addText(label, {
        x: chipX,
        y: 6.95,
        w: 1.55,
        h: 0.36,
        align: "center",
        valign: "middle",
        fontFace: "Calibri",
        fontSize: 10,
        bold: true,
        color: STORY.ink
      });
      chipX += 1.65;
      if (chipX > 12.3) break;
    }

    const notes = buildNotes({
      courseTitle: output.project.title,
      unit,
      audioScript,
      buildNotes: build,
      studentText: unit.content_outline,
      interactivity,
      visualQuery,
      visualAttribution: visual?.attributionLines ?? [],
      extraResources: resources
    });
    slide.addNotes(notes);
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
  options?: { mode?: string; courseName?: string }
): Promise<Buffer> {
  const mode = (options?.mode ?? "full") as string;
  if (mode === "ova-storyboard") {
    return toPptxBufferStoryboard(output, { courseName: options?.courseName });
  }
  return toPptxBufferOverview(output);
}
