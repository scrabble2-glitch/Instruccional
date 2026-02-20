import PptxGenJS from "pptxgenjs";
import type { InstructionalDesignOutput } from "@/lib/validators/output-schema";
import { resolveStoryboardVisual, type ResolvedVisual } from "@/lib/services/storyboard-visuals";

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
    return (
      key !== "guion_audio" &&
      key !== "notas_construccion" &&
      key !== "imagen_query" &&
      key !== "icon_query" &&
      key !== "visual_spec" &&
      key !== "infografia_tecnica"
    );
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
  iconQuery: string | null;
  iconAttribution: string[];
  visualSpecRaw: string | null;
  infographicTechRaw: string | null;
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

  lines.push("VISUAL / IMAGEN (auto):");
  lines.push(`Query: ${params.visualQuery?.trim() ? safeLine(params.visualQuery) : "N/D (se usó fallback automático)"}`);
  if (params.visualAttribution.length) {
    for (const line of params.visualAttribution) lines.push(safeLine(line));
  } else {
    lines.push("(Sin imagen incrustada: revisa el término de búsqueda y tu conexión a internet.)");
  }
  lines.push("");

  lines.push("ICONOGRAFIA (auto):");
  lines.push(`Query: ${params.iconQuery?.trim() ? safeLine(params.iconQuery) : "N/D (se usó fallback automático)"}`);
  if (params.iconAttribution.length) {
    for (const line of params.iconAttribution) lines.push(safeLine(line));
  } else {
    lines.push("(Sin ícono incrustado: revisar icon_query y disponibilidad del proveedor.)");
  }
  lines.push("");

  lines.push("VISUAL SPEC (infografia / UI):");
  lines.push(params.visualSpecRaw?.trim() ? params.visualSpecRaw.trim() : "(No provisto por IA. Regenera para completar.)");
  lines.push("");

  lines.push("ESPECIFICACION TECNICA DE INFOGRAFIA:");
  lines.push(
    params.infographicTechRaw?.trim() ? params.infographicTechRaw.trim() : "(No provista por IA. Regenera para completar.)"
  );
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

const STORY_MASTERS = [
  {
    name: "Atlas",
    accent: STORY.accent,
    accent2: STORY.accent2,
    panelTint: "ECFEFF",
    panelBorder: "A5F3FC"
  },
  {
    name: "Nexo",
    accent: "0369A1",
    accent2: "0EA5E9",
    panelTint: "EFF6FF",
    panelBorder: "BFDBFE"
  },
  {
    name: "Impulso",
    accent: "0F766E",
    accent2: "22C55E",
    panelTint: "ECFDF5",
    panelBorder: "99F6E4"
  }
] as const;

function masterForUnit(index: number) {
  return STORY_MASTERS[index % STORY_MASTERS.length];
}

function buildSoftShadow(): {
  type: "outer";
  color: string;
  opacity: number;
  blur: number;
  offset: number;
  angle: number;
} {
  return {
    type: "outer",
    color: "000000",
    opacity: 0.12,
    blur: 10,
    offset: 2,
    angle: 45
  };
}

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

function addVisualWatermark(
  slide: PptxGenJS.Slide,
  params: { x: number; y: number; w: number; h: number; label: string }
) {
  const label = safeLine(params.label);
  if (!label) return;

  // "Draft" watermark to signal the visual is provisional and must be reviewed/licensed.
  slide.addText(label, {
    x: params.x,
    y: params.y + params.h / 2 - 0.3,
    w: params.w,
    h: 0.6,
    align: "center",
    valign: "middle",
    fontFace: "Calibri",
    fontSize: 34,
    bold: true,
    color: "CBD5E1",
    rotate: -25
  });
}

type StoryVisualLayout = "process_steps" | "cards" | "timeline" | "bullets";
type StoryVisualMode = "auto" | "infographic" | "image_support" | "comparison" | "activity";

interface StoryVisualItem {
  label?: string;
  title: string;
  body: string;
}

interface StoryPopupSpec {
  button: string;
  title: string;
  body: string;
}

interface StoryVisualSpec {
  layout: StoryVisualLayout;
  visualMode: StoryVisualMode;
  items: StoryVisualItem[];
  buttons: string[];
  popups: StoryPopupSpec[];
}

function parseButtonsLine(value: string): string[] {
  return value
    .split(",")
    .map((part) => safeLine(part))
    .map((part) => part.replace(/^[•\\-\\s]+/g, "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function parseVisualSpec(raw: string | null, fallbackFrom: { title: string; content: string[] }): StoryVisualSpec {
  const base: StoryVisualSpec = { layout: "bullets", visualMode: "auto", items: [], buttons: [], popups: [] };
  if (!raw?.trim()) {
    // Basic fallback from content_outline
    const items = clampLines(fallbackFrom.content, 4, 90).map((line) => ({ title: line, body: "" }));
    return { ...base, layout: items.length >= 3 ? "process_steps" : "cards", items };
  }

  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let inItems = false;
  let inPopups = false;
  for (const line of lines) {
    const lower = line.toLowerCase();

    if (lower.startsWith("layout:") || lower.startsWith("layout=")) {
      const value = line.split(/[:=]/).slice(1).join(":").trim().toLowerCase();
      if (value.includes("process")) base.layout = "process_steps";
      else if (value.includes("cards")) base.layout = "cards";
      else if (value.includes("timeline")) base.layout = "timeline";
      else base.layout = "bullets";
      continue;
    }

    if (
      lower.startsWith("visual_mode:") ||
      lower.startsWith("visual_mode=") ||
      lower.startsWith("tipo_visual:") ||
      lower.startsWith("tipo_visual=")
    ) {
      const value = normalizeKey(line.split(/[:=]/).slice(1).join(":").trim());
      if (value.includes("infografia")) base.visualMode = "infographic";
      else if (value.includes("compar")) base.visualMode = "comparison";
      else if (value.includes("imagen") || value.includes("support")) base.visualMode = "image_support";
      else if (value.includes("actividad") || value.includes("interact")) base.visualMode = "activity";
      else base.visualMode = "auto";
      continue;
    }

    if (lower.startsWith("items:") || lower.startsWith("items=") || lower.startsWith("elementos:")) {
      inItems = true;
      inPopups = false;
      const inline = line.split(/[:=]/).slice(1).join(":").trim();
      if (inline) {
        // Allow inline "items=" separated by ";"
        for (const item of inline.split(";")) {
          const parts = item.split("|").map((p) => safeLine(p));
          const cleaned = parts.map((p) => p.trim()).filter(Boolean);
          if (!cleaned.length) continue;
          if (cleaned.length >= 3) {
            base.items.push({ label: cleaned[0], title: cleaned[1], body: cleaned.slice(2).join(" | ") });
          } else if (cleaned.length === 2) {
            base.items.push({ title: cleaned[0], body: cleaned[1] });
          } else {
            base.items.push({ title: cleaned[0], body: "" });
          }
        }
      }
      continue;
    }

    if (lower.startsWith("buttons:") || lower.startsWith("buttons=") || lower.startsWith("botones:")) {
      const value = line.split(/[:=]/).slice(1).join(":").trim();
      base.buttons = parseButtonsLine(value);
      inItems = false;
      inPopups = false;
      continue;
    }

    if (lower.startsWith("popups:") || lower.startsWith("popups=") || lower.startsWith("capas:") || lower.startsWith("layers:")) {
      inItems = false;
      inPopups = true;
      continue;
    }

    if (inItems && (line.startsWith("-") || line.startsWith("•"))) {
      const trimmed = line.replace(/^[-•]\s*/g, "").trim();
      const parts = trimmed.split("|").map((p) => safeLine(p));
      const cleaned = parts.map((p) => p.trim()).filter(Boolean);
      if (!cleaned.length) continue;
      if (cleaned.length >= 3) {
        base.items.push({ label: cleaned[0], title: cleaned[1], body: cleaned.slice(2).join(" | ") });
      } else if (cleaned.length === 2) {
        base.items.push({ title: cleaned[0], body: cleaned[1] });
      } else {
        base.items.push({ title: cleaned[0], body: "" });
      }
      continue;
    }

    if (inPopups && (line.startsWith("-") || line.startsWith("•"))) {
      const trimmed = line.replace(/^[-•]\s*/g, "").trim();
      const parts = trimmed.split("|").map((p) => safeLine(p));
      const cleaned = parts.map((p) => p.trim()).filter(Boolean);
      if (!cleaned.length) continue;
      if (cleaned.length >= 3) {
        base.popups.push({ button: cleaned[0], title: cleaned[1], body: cleaned.slice(2).join(" | ") });
      } else if (cleaned.length === 2) {
        base.popups.push({ button: cleaned[0], title: cleaned[1], body: "" });
      } else {
        base.popups.push({ button: cleaned[0], title: cleaned[0], body: "" });
      }
      continue;
    }

    // Any other line ends the list sections.
    inItems = false;
    inPopups = false;
  }

  if (!base.items.length) {
    const fallbackItems = clampLines(fallbackFrom.content, 4, 90).map((line) => ({ title: line, body: "" }));
    base.items = fallbackItems;
    if (base.layout === "bullets") {
      base.layout = fallbackItems.length >= 3 ? "process_steps" : "cards";
    }
  }

  // Keep things on-slide concise.
  base.items = base.items
    .slice(0, 5)
    .map((item) => ({
      label: item.label ? truncateText(item.label, 18) : undefined,
      title: truncateText(item.title, 46),
      body: truncateText(item.body || "", 120)
    }));

  base.popups = base.popups
    .slice(0, 3)
    .map((popup) => ({
      button: truncateText(popup.button, 18),
      title: truncateText(popup.title, 50),
      body: truncateText(popup.body || "", 240)
    }));

  // If buttons exist but popups are missing, create minimal popups so the PPT prototype is functional.
  if (base.buttons.length && base.popups.length === 0) {
    const fallbackBody = base.items.map((item) => item.body || item.title).filter(Boolean);
    base.popups = base.buttons.slice(0, 3).map((button, idx) => ({
      button: truncateText(button, 18),
      title: truncateText(button, 50),
      body: truncateText(fallbackBody[idx] ?? fallbackBody[0] ?? "", 240)
    }));
  }

  return base;
}

interface InfographicTechnicalSpec {
  topic: string;
  requiresInfographic: boolean;
  dataStructure: string[];
  visualMetaphor: string;
  mermaidCode: string;
  palette: string[];
  iconStyle: string;
}

function extractHexPalette(text: string): string[] {
  const matches = text.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  const unique = new Set(matches.map((value) => value.toUpperCase()));
  return Array.from(unique).slice(0, 6);
}

function slugifyMermaidNode(value: string, fallbackIndex: number): string {
  const cleaned = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 18);
  if (cleaned) return cleaned;
  return `node_${fallbackIndex + 1}`;
}

function buildFallbackMermaid(params: { topic: string; dataStructure: string[] }): string {
  const nodes = (params.dataStructure.length ? params.dataStructure : [params.topic]).slice(0, 5);
  const lines = ["flowchart LR"];
  for (let i = 0; i < nodes.length; i += 1) {
    const id = slugifyMermaidNode(nodes[i], i);
    lines.push(`${id}["${truncateText(nodes[i], 40)}"]`);
    if (i > 0) {
      const prev = slugifyMermaidNode(nodes[i - 1], i - 1);
      lines.push(`${prev} --> ${id}`);
    }
  }
  return lines.join("\n");
}

function parseInfographicTechnicalSpec(
  raw: string | null,
  fallbackFrom: { topic: string; visual: StoryVisualSpec }
): InfographicTechnicalSpec {
  const inlineMermaidField = raw?.match(/codigo[_\s]mermaid\s*[:=]\s*([^\n]+)/i)?.[1]?.trim() ?? "";
  const fallbackData = fallbackFrom.visual.items.length
    ? fallbackFrom.visual.items.map((item) => `${item.title}${item.body ? ` > ${item.body}` : ""}`)
    : clampLines([fallbackFrom.topic], 1, 80);

  const base: InfographicTechnicalSpec = {
    topic: truncateText(fallbackFrom.topic, 70),
    requiresInfographic: false,
    dataStructure: clampLines(fallbackData, 5, 95),
    visualMetaphor: "Ruta secuencial de aprendizaje con nodos conectados.",
    mermaidCode: "",
    palette: ["#0B7285", "#0EA5E9", "#F8FAFC", "#0F172A"],
    iconStyle: "lineal"
  };

  if (!raw?.trim()) {
    base.requiresInfographic = fallbackFrom.visual.layout === "process_steps" || fallbackFrom.visual.layout === "timeline";
    base.mermaidCode = buildFallbackMermaid({ topic: base.topic, dataStructure: base.dataStructure });
    return base;
  }

  const lines = raw.split(/\r?\n/g);
  let activeList: "data" | "palette" | null = null;
  let inMermaidBlock = false;
  const mermaidLines: string[] = [];
  const dataLines: string[] = [];
  const paletteLines: string[] = [];
  const metadata = raw.toLowerCase();

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    const lower = line.toLowerCase();
    const normalized = normalizeKey(line);
    if (!line) continue;

    if (line.startsWith("```")) {
      if (inMermaidBlock) {
        inMermaidBlock = false;
        continue;
      }
      if (lower.includes("mermaid")) {
        inMermaidBlock = true;
        continue;
      }
    }

    if (inMermaidBlock) {
      mermaidLines.push(lineRaw.replace(/\t/g, "  "));
      continue;
    }

    if (
      normalized.startsWith("tema:") ||
      normalized.startsWith("tema=") ||
      normalized.startsWith("topic:") ||
      normalized.startsWith("topic=")
    ) {
      base.topic = truncateText(line.split(/[:=]/).slice(1).join(":").trim() || base.topic, 70);
      activeList = null;
      continue;
    }

    if (
      normalized.startsWith("requiere_infografia:") ||
      normalized.startsWith("requiere_infografia=") ||
      normalized.startsWith("requiere infografia:")
    ) {
      const value = normalizeKey(line.split(/[:=]/).slice(1).join(":"));
      base.requiresInfographic = value.includes("si") || value.includes("yes") || value.includes("true");
      activeList = null;
      continue;
    }

    if (normalized.startsWith("estructura_datos:") || normalized.startsWith("estructura de datos:")) {
      activeList = "data";
      continue;
    }

    if (normalized.startsWith("metafora_visual:") || normalized.startsWith("metafora visual:")) {
      base.visualMetaphor = truncateText(line.split(/[:=]/).slice(1).join(":").trim() || base.visualMetaphor, 120);
      activeList = null;
      continue;
    }

    if (
      normalized.startsWith("codigo_mermaid:") ||
      normalized.startsWith("codigo mermaid:") ||
      normalized.startsWith("mermaid:")
    ) {
      activeList = null;
      continue;
    }

    if (normalized.startsWith("paleta_colores:") || normalized.startsWith("paleta de colores:")) {
      activeList = "palette";
      continue;
    }

    if (
      normalized.startsWith("estilo_iconografia:") ||
      normalized.startsWith("estilo iconografia:") ||
      normalized.startsWith("iconografia:")
    ) {
      base.iconStyle = truncateText(line.split(/[:=]/).slice(1).join(":").trim() || base.iconStyle, 60);
      activeList = null;
      continue;
    }

    if ((line.startsWith("-") || line.startsWith("•")) && activeList === "data") {
      dataLines.push(line.replace(/^[-•]\s*/g, "").trim());
      continue;
    }

    if ((line.startsWith("-") || line.startsWith("•")) && activeList === "palette") {
      paletteLines.push(line.replace(/^[-•]\s*/g, "").trim());
      continue;
    }
  }

  if (!dataLines.length) {
    const fallbackDataFromRaw = raw
      .split(/\r?\n/g)
      .map((line) => safeLine(line))
      .filter((line) => line.startsWith("-") || line.startsWith("•"))
      .map((line) => line.replace(/^[-•]\s*/g, ""))
      .filter(Boolean);
    if (fallbackDataFromRaw.length) dataLines.push(...fallbackDataFromRaw);
  }

  if (dataLines.length) {
    base.dataStructure = clampLines(dataLines, 6, 95);
  }

  const inlineMermaid = raw.match(/```mermaid\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (inlineMermaid) {
    base.mermaidCode = inlineMermaid;
  } else if (inlineMermaidField) {
    base.mermaidCode = inlineMermaidField;
  } else if (mermaidLines.length) {
    base.mermaidCode = mermaidLines.join("\n").trim();
  } else {
    base.mermaidCode = buildFallbackMermaid({ topic: base.topic, dataStructure: base.dataStructure });
  }

  const palette = [...extractHexPalette(raw), ...extractHexPalette(paletteLines.join("\n"))];
  if (palette.length) {
    base.palette = palette.slice(0, 6);
  }

  if (!base.visualMetaphor.trim()) {
    base.visualMetaphor = base.requiresInfographic
      ? "Mapa de conceptos conectados con progresion visual."
      : "No aplica infografia compleja; usar imagen de apoyo contextual.";
  }

  if (!base.iconStyle.trim()) {
    base.iconStyle = metadata.includes("3d") ? "3D suave" : "lineal";
  }

  return base;
}

interface MermaidNode {
  id: string;
  label: string;
}

interface MermaidEdge {
  from: string;
  to: string;
}

interface MermaidGraph {
  direction: "LR" | "TB";
  nodes: MermaidNode[];
  edges: MermaidEdge[];
}

function parseMermaidGraph(code: string): MermaidGraph | null {
  if (!code.trim()) return null;

  const lines = code
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  let direction: "LR" | "TB" = "LR";
  const first = lines[0].toLowerCase();
  if (first.startsWith("flowchart") || first.startsWith("graph")) {
    if (first.includes("tb") || first.includes("td")) direction = "TB";
    if (first.includes("lr")) direction = "LR";
  }

  const nodeMap = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];

  const nodeDefRegex = /([A-Za-z0-9_]+)\s*\["([^"]+)"\]/g;
  for (const line of lines) {
    let match: RegExpExecArray | null = null;
    while ((match = nodeDefRegex.exec(line)) !== null) {
      const id = match[1];
      const label = truncateText(match[2], 40);
      if (!nodeMap.has(id)) {
        nodeMap.set(id, { id, label });
      }
    }
  }

  const edgeRegex = /([A-Za-z0-9_]+)\s*[-.]+>?[-.]*\s*([A-Za-z0-9_]+)/g;
  for (const line of lines) {
    let match: RegExpExecArray | null = null;
    while ((match = edgeRegex.exec(line)) !== null) {
      const from = match[1];
      const to = match[2];
      if (from.toLowerCase() === "flowchart" || from.toLowerCase() === "graph") continue;
      if (!nodeMap.has(from)) nodeMap.set(from, { id: from, label: from });
      if (!nodeMap.has(to)) nodeMap.set(to, { id: to, label: to });
      edges.push({ from, to });
    }
  }

  const nodes = Array.from(nodeMap.values()).slice(0, 6);
  const edgeFiltered = edges.filter(
    (edge) => nodes.some((node) => node.id === edge.from) && nodes.some((node) => node.id === edge.to)
  );

  if (!nodes.length) return null;
  return {
    direction,
    nodes,
    edges: edgeFiltered
  };
}

function orderMermaidNodes(graph: MermaidGraph): MermaidNode[] {
  if (!graph.edges.length) return graph.nodes.slice(0, 5);

  const incoming = new Map<string, number>();
  for (const node of graph.nodes) incoming.set(node.id, 0);
  for (const edge of graph.edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);

  const startNode = graph.nodes.find((node) => (incoming.get(node.id) ?? 0) === 0) ?? graph.nodes[0];
  const ordered: MermaidNode[] = [];
  const visited = new Set<string>();
  let cursor: MermaidNode | undefined = startNode;

  while (cursor && !visited.has(cursor.id) && ordered.length < 5) {
    ordered.push(cursor);
    visited.add(cursor.id);
    const nextEdge = graph.edges.find((edge) => edge.from === cursor?.id && !visited.has(edge.to));
    cursor = nextEdge ? graph.nodes.find((node) => node.id === nextEdge.to) : undefined;
  }

  for (const node of graph.nodes) {
    if (ordered.length >= 5) break;
    if (!visited.has(node.id)) ordered.push(node);
  }

  return ordered;
}

function renderMermaidMiniDiagram(
  slide: PptxGenJS.Slide,
  area: { x: number; y: number; w: number; h: number },
  spec: InfographicTechnicalSpec
) {
  const graph = parseMermaidGraph(spec.mermaidCode);
  if (!graph) {
    slide.addText(clampLines(spec.mermaidCode.split(/\r?\n/g), 7, 52).join("\n"), {
      x: area.x,
      y: area.y,
      w: area.w,
      h: area.h,
      fontFace: "Consolas",
      fontSize: 7,
      color: STORY.muted,
      valign: "top"
    });
    return;
  }

  const nodes = orderMermaidNodes(graph);
  const palette = spec.palette.length ? spec.palette : ["#0B7285", "#0EA5E9", "#38BDF8", "#0F172A"];
  const nodeCount = Math.max(1, Math.min(nodes.length, 5));
  if (graph.direction === "TB") {
    const gapY = 0.08;
    const nodeH = Math.max(0.26, (area.h - gapY * (nodeCount - 1)) / nodeCount);
    for (let i = 0; i < nodeCount; i += 1) {
      const node = nodes[i];
      const ny = area.y + i * (nodeH + gapY);
      const color = palette[i % palette.length].replace("#", "");
      slide.addShape("roundRect", {
        x: area.x,
        y: ny,
        w: area.w,
        h: nodeH,
        fill: { color, transparency: 10 },
        line: { color, transparency: 30 }
      });
      slide.addText(truncateText(node.label, 32), {
        x: area.x + 0.08,
        y: ny + 0.05,
        w: area.w - 0.16,
        h: nodeH - 0.08,
        align: "center",
        valign: "middle",
        fontFace: "Calibri",
        fontSize: 8,
        bold: true,
        color: STORY.card
      });
      if (i < nodeCount - 1) {
        slide.addShape("line", {
          x: area.x + area.w / 2,
          y: ny + nodeH + 0.005,
          w: 0.001,
          h: 0.05,
          line: { color: "94A3B8", pt: 1, transparency: 10 }
        });
      }
    }
    return;
  }

  const gapX = 0.08;
  const nodeW = Math.max(0.48, (area.w - gapX * (nodeCount - 1)) / nodeCount);
  for (let i = 0; i < nodeCount; i += 1) {
    const node = nodes[i];
    const nx = area.x + i * (nodeW + gapX);
    const color = palette[i % palette.length].replace("#", "");
    slide.addShape("roundRect", {
      x: nx,
      y: area.y,
      w: nodeW,
      h: area.h,
      fill: { color, transparency: 10 },
      line: { color, transparency: 30 }
    });
    slide.addText(truncateText(node.label, 32), {
      x: nx + 0.06,
      y: area.y + 0.05,
      w: nodeW - 0.12,
      h: area.h - 0.12,
      align: "center",
      valign: "middle",
      fontFace: "Calibri",
      fontSize: 8,
      bold: true,
      color: STORY.card
    });
    if (i < nodeCount - 1) {
      slide.addShape("line", {
        x: nx + nodeW + 0.01,
        y: area.y + area.h / 2,
        w: 0.05,
        h: 0.001,
        line: { color: "94A3B8", pt: 1, transparency: 10 }
      });
    }
  }
}

function renderInfographic(
  slide: PptxGenJS.Slide,
  area: { x: number; y: number; w: number; h: number },
  spec: StoryVisualSpec
) {
  const x = area.x;
  const y = area.y;
  const w = area.w;
  const h = area.h;

  if (spec.layout === "timeline") {
    const lineX = x + 0.35;
    slide.addShape("rect", { x: lineX, y, w: 0.04, h, fill: { color: STORY.soft } });
    const n = Math.max(1, Math.min(spec.items.length, 5));
    const gap = n > 1 ? h / (n - 1) : 0;
    for (let i = 0; i < n; i += 1) {
      const item = spec.items[i];
      const cy = y + i * gap;
      slide.addShape("ellipse", {
        x: lineX - 0.09,
        y: cy - 0.09,
        w: 0.18,
        h: 0.18,
        fill: { color: STORY.accent },
        line: { color: STORY.accent }
      });
      slide.addText(item.title, {
        x: lineX + 0.25,
        y: cy - 0.12,
        w: w - 0.6,
        h: 0.22,
        fontFace: "Calibri",
        fontSize: 12,
        bold: true,
        color: STORY.ink
      });
      if (item.body?.trim()) {
        slide.addText(item.body, {
          x: lineX + 0.25,
          y: cy + 0.1,
          w: w - 0.6,
          h: 0.3,
          fontFace: "Calibri",
          fontSize: 10,
          color: STORY.muted
        });
      }
    }
    return;
  }

  if (spec.layout === "cards") {
    const n = Math.max(1, Math.min(spec.items.length, 4));
    const cols = n <= 2 ? 2 : 2;
    const rows = Math.ceil(n / cols);
    const gapX = 0.18;
    const gapY = 0.15;
    const cardW = (w - gapX * (cols - 1)) / cols;
    const cardH = (h - gapY * (rows - 1)) / rows;
    const iconShapes = ["hexagon", "ellipse", "diamond", "triangle"] as const;

    for (let i = 0; i < n; i += 1) {
      const item = spec.items[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = x + col * (cardW + gapX);
      const cy = y + row * (cardH + gapY);

      slide.addShape("roundRect", {
        x: cx,
        y: cy,
        w: cardW,
        h: cardH,
        fill: { color: "F8FAFC" },
        line: { color: STORY.soft, width: 1 },
        shadow: buildSoftShadow()
      });

      // Accent stripe + icon to reduce "flat" look.
      slide.addShape("rect", {
        x: cx,
        y: cy,
        w: cardW,
        h: 0.08,
        fill: { color: i % 2 === 0 ? STORY.accent : STORY.accent2, transparency: 10 },
        line: { color: STORY.soft, transparency: 100 }
      });
      slide.addShape(iconShapes[i % iconShapes.length], {
        x: cx + 0.15,
        y: cy + 0.14,
        w: 0.34,
        h: 0.34,
        fill: { color: i % 2 === 0 ? STORY.accent : STORY.accent2, transparency: 20 },
        line: { color: i % 2 === 0 ? STORY.accent : STORY.accent2, transparency: 40 }
      });

      slide.addText(item.title, {
        x: cx + 0.55,
        y: cy + 0.13,
        w: cardW - 0.7,
        h: 0.25,
        fontFace: "Calibri",
        fontSize: 11,
        bold: true,
        color: STORY.ink
      });
      if (item.body?.trim()) {
        slide.addText(item.body, {
          x: cx + 0.15,
          y: cy + 0.45,
          w: cardW - 0.3,
          h: cardH - 0.52,
          fontFace: "Calibri",
          fontSize: 10,
          color: STORY.muted,
          valign: "top"
        });
      }
    }
    return;
  }

  if (spec.layout === "process_steps") {
    const n = Math.max(1, Math.min(spec.items.length, 4));
    const gapY = 0.12;
    const cardH = (h - gapY * (n - 1)) / n;
    for (let i = 0; i < n; i += 1) {
      const item = spec.items[i];
      const cy = y + i * (cardH + gapY);
      slide.addShape("roundRect", {
        x,
        y: cy,
        w,
        h: cardH,
        fill: { color: "F8FAFC" },
        line: { color: STORY.soft, width: 1 },
        shadow: buildSoftShadow()
      });
      slide.addShape("rect", {
        x,
        y: cy,
        w: 0.08,
        h: cardH,
        fill: { color: STORY.accent, transparency: 10 },
        line: { color: STORY.accent, transparency: 100 }
      });
      slide.addShape("ellipse", {
        x: x + 0.15,
        y: cy + 0.15,
        w: 0.35,
        h: 0.35,
        fill: { color: STORY.accent },
        line: { color: STORY.accent }
      });
      slide.addText(String(i + 1), {
        x: x + 0.15,
        y: cy + 0.17,
        w: 0.35,
        h: 0.31,
        align: "center",
        valign: "middle",
        fontFace: "Calibri",
        fontSize: 13,
        bold: true,
        color: STORY.card
      });

      const titleX = x + 0.6;
      slide.addText(item.title, {
        x: titleX,
        y: cy + 0.1,
        w: w - 0.75,
        h: 0.22,
        fontFace: "Calibri",
        fontSize: 12,
        bold: true,
        color: STORY.ink
      });
      if (item.body?.trim()) {
        slide.addText(item.body, {
          x: titleX,
          y: cy + 0.34,
          w: w - 0.75,
          h: cardH - 0.4,
          fontFace: "Calibri",
          fontSize: 10,
          color: STORY.muted,
          valign: "top"
        });
      }

      // Connector arrow between steps.
      if (i < n - 1) {
        slide.addShape("line", {
          x: x + w / 2,
          y: cy + cardH + 0.01,
          w: 0.001,
          h: 0.14,
          line: { color: STORY.accent2, pt: 1.2, transparency: 30 }
        });
      }
    }
    return;
  }

  // bullets fallback
  slide.addText(clampLines(spec.items.map((item) => item.title), 6, 95).join("\n"), {
    x,
    y,
    w,
    h,
    fontFace: "Calibri",
    fontSize: 16,
    color: STORY.ink,
    valign: "top",
    bullet: true
  });
}

function renderNarrativeText(
  slide: PptxGenJS.Slide,
  area: { x: number; y: number; w: number; h: number },
  lines: string[]
) {
  const summary = clampLines(lines, 7, 110);
  slide.addShape("roundRect", {
    x: area.x,
    y: area.y,
    w: area.w,
    h: area.h,
    fill: { color: "F8FAFC" },
    line: { color: STORY.soft, width: 1 },
    shadow: buildSoftShadow()
  });
  slide.addText(summary.join("\n"), {
    x: area.x + 0.2,
    y: area.y + 0.2,
    w: area.w - 0.4,
    h: area.h - 0.4,
    fontFace: "Calibri",
    fontSize: 12,
    color: STORY.ink,
    bullet: true,
    valign: "top"
  });
}

function renderComparison(
  slide: PptxGenJS.Slide,
  area: { x: number; y: number; w: number; h: number },
  items: StoryVisualItem[]
) {
  const source = items.length ? items : [{ title: "Tema A", body: "" }, { title: "Tema B", body: "" }];
  const cols = Math.min(3, Math.max(2, source.length));
  const gap = 0.14;
  const cardW = (area.w - gap * (cols - 1)) / cols;
  const cardH = area.h;

  for (let i = 0; i < cols; i += 1) {
    const item = source[i];
    const x = area.x + i * (cardW + gap);
    slide.addShape("roundRect", {
      x,
      y: area.y,
      w: cardW,
      h: cardH,
      fill: { color: "FFFFFF" },
      line: { color: STORY.soft, width: 1 },
      shadow: buildSoftShadow()
    });
    slide.addText(truncateText(item.title, 34), {
      x: x + 0.14,
      y: area.y + 0.12,
      w: cardW - 0.28,
      h: 0.24,
      fontFace: "Calibri",
      fontSize: 11,
      bold: true,
      color: STORY.ink
    });
    if (item.body?.trim()) {
      slide.addText(truncateText(item.body, 180), {
        x: x + 0.14,
        y: area.y + 0.4,
        w: cardW - 0.28,
        h: cardH - 0.55,
        fontFace: "Calibri",
        fontSize: 10,
        color: STORY.muted,
        valign: "top"
      });
    }
  }
}

function renderActivityCanvas(
  slide: PptxGenJS.Slide,
  area: { x: number; y: number; w: number; h: number },
  interactivityLines: string[],
  specItems: StoryVisualItem[]
) {
  const baseLines = interactivityLines.length
    ? interactivityLines
    : specItems.map((item) => `${item.title}${item.body ? `: ${item.body}` : ""}`);
  const lines = clampLines(baseLines, 4, 90);

  slide.addShape("roundRect", {
    x: area.x,
    y: area.y,
    w: area.w,
    h: area.h,
    fill: { color: "FFFFFF" },
    line: { color: STORY.soft, width: 1 },
    shadow: buildSoftShadow()
  });

  slide.addText("Actividad guiada", {
    x: area.x + 0.18,
    y: area.y + 0.12,
    w: area.w - 0.36,
    h: 0.22,
    fontFace: "Calibri",
    fontSize: 11,
    bold: true,
    color: STORY.ink
  });

  const rowH = Math.max(0.32, (area.h - 0.52) / Math.max(1, lines.length));
  for (let i = 0; i < lines.length; i += 1) {
    const y = area.y + 0.38 + i * rowH;
    slide.addShape("ellipse", {
      x: area.x + 0.18,
      y: y + 0.03,
      w: 0.16,
      h: 0.16,
      fill: { color: i % 2 === 0 ? STORY.accent : STORY.accent2 },
      line: { color: i % 2 === 0 ? STORY.accent : STORY.accent2 }
    });
    slide.addText(String(i + 1), {
      x: area.x + 0.18,
      y: y + 0.035,
      w: 0.16,
      h: 0.145,
      align: "center",
      valign: "middle",
      fontFace: "Calibri",
      fontSize: 7,
      bold: true,
      color: STORY.card
    });
    slide.addText(lines[i], {
      x: area.x + 0.4,
      y,
      w: area.w - 0.56,
      h: rowH - 0.02,
      fontFace: "Calibri",
      fontSize: 9,
      color: STORY.muted,
      valign: "top"
    });
  }
}

function addIconMarker(slide: PptxGenJS.Slide, params: { x: number; y: number; size: number; icon: ResolvedVisual | null }) {
  slide.addShape("roundRect", {
    x: params.x,
    y: params.y,
    w: params.size,
    h: params.size,
    fill: { color: "FFFFFF" },
    line: { color: STORY.soft, width: 1 },
    shadow: buildSoftShadow()
  });

  if (params.icon?.imagePath) {
    slide.addImage({
      path: params.icon.imagePath,
      x: params.x + 0.05,
      y: params.y + 0.05,
      w: params.size - 0.1,
      h: params.size - 0.1,
      sizing: { type: "contain", w: params.size - 0.1, h: params.size - 0.1 }
    });
    return;
  }

  slide.addShape("ellipse", {
    x: params.x + 0.15,
    y: params.y + 0.15,
    w: params.size - 0.3,
    h: params.size - 0.3,
    fill: { color: STORY.accent2, transparency: 50 },
    line: { color: STORY.accent2, transparency: 25 }
  });
  slide.addText("i", {
    x: params.x + 0.15,
    y: params.y + 0.18,
    w: params.size - 0.3,
    h: params.size - 0.34,
    align: "center",
    valign: "middle",
    fontFace: "Calibri",
    fontSize: 18,
    bold: true,
    color: STORY.ink
  });
}

function resolveVisualMode(
  spec: StoryVisualSpec,
  infographicSpec: InfographicTechnicalSpec,
  contentLines: string[]
): StoryVisualMode {
  if (spec.visualMode !== "auto") {
    return spec.visualMode;
  }

  const contentSize = contentLines.join(" ").trim().length;
  const hasComparisonHints = contentLines.some((line) =>
    /(versus|vs\.?|compar|diferencia|ventajas|desventajas)/i.test(line)
  );
  const hasStepHints = contentLines.some((line) =>
    /(paso|proceso|etapa|fases|secuencia|timeline)/i.test(line)
  );

  if (infographicSpec.requiresInfographic || spec.layout === "timeline" || hasStepHints) {
    return "infographic";
  }
  if (hasComparisonHints || spec.layout === "cards") {
    return "comparison";
  }
  if (contentSize > 700) {
    return "activity";
  }
  return "image_support";
}

function addOverlayButtons(
  slide: PptxGenJS.Slide,
  params: { x: number; y: number; w: number },
  buttons: Array<{ label: string; slide?: number }>
) {
  const cleaned = buttons
    .map((btn) => ({ label: truncateText(btn.label, 18), slide: btn.slide }))
    .filter((btn) => Boolean(btn.label))
    .slice(0, 3);
  if (!cleaned.length) return;

  const gap = 0.12;
  const btnH = 0.34;
  const btnW = (params.w - gap * (cleaned.length - 1)) / cleaned.length;

  for (let i = 0; i < cleaned.length; i += 1) {
    const x = params.x + i * (btnW + gap);
    const link = cleaned[i].slide ? { slide: cleaned[i].slide } : undefined;
    slide.addShape("roundRect", {
      x,
      y: params.y,
      w: btnW,
      h: btnH,
      fill: { color: "FFFFFF", transparency: 10 },
      line: { color: STORY.soft, width: 1 },
      hyperlink: link
    });
    slide.addText(cleaned[i].label, {
      x,
      y: params.y + 0.03,
      w: btnW,
      h: btnH - 0.02,
      align: "center",
      valign: "middle",
      fontFace: "Calibri",
      fontSize: 10,
      bold: true,
      color: STORY.ink,
      hyperlink: link
    });
  }
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

function addStoryFooterNav(
  slide: PptxGenJS.Slide,
  links: { menuSlide: number; backSlide?: number; nextSlide?: number }
) {
  const y = 6.92;
  const btn = (x: number, label: string, targetSlide?: number) => {
    const link = targetSlide ? { slide: targetSlide } : undefined;
    slide.addShape("roundRect", {
      x,
      y,
      w: 1.6,
      h: 0.42,
      fill: { color: STORY.card },
      line: { color: STORY.soft, width: 1 },
      hyperlink: link
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
      color: STORY.muted,
      hyperlink: link
    });
  };
  btn(0.7, "Menú", links.menuSlide);
  btn(2.45, "Atrás", links.backSlide);
  btn(4.2, "Siguiente", links.nextSlide);
}

function addStoryboardCover(
  pptx: PptxGenJS,
  output: InstructionalDesignOutput,
  visual: ResolvedVisual | null,
  menuSlide: number
) {
  const slide = pptx.addSlide();
  addStoryBackground(slide);
  addStoryTopBar(slide, { left: output.project.title, right: "PORTADA" });
  const startLink = { slide: menuSlide };

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
    if (visual.watermarkLabel) {
      addVisualWatermark(slide, { x: 7.2, y: 0.8, w: 5.38, h: 5.95, label: visual.watermarkLabel });
    }
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
    fill: { color: STORY.accent },
    hyperlink: startLink
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
    color: STORY.card,
    hyperlink: startLink
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

  addStoryFooterNav(slide, { menuSlide, nextSlide: menuSlide });
}

function addStoryboardMenu(
  pptx: PptxGenJS,
  output: InstructionalDesignOutput,
  visual: ResolvedVisual | null,
  menuTargets: Array<{ unitId: string; title: string; slide: number }>,
  links: { menuSlide: number; backSlide?: number; nextSlide?: number }
) {
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

  // Clickable menu buttons (prototype navigation).
  const gapX = 0.18;
  const gapY = 0.14;
  const cols = 2;
  const btnArea = { x: 1.0, y: 1.85, w: 5.8, h: 4.55 };
  const btnW = (btnArea.w - gapX * (cols - 1)) / cols;
  const btnH = 0.56;

  const targets = menuTargets.slice(0, 16);
  for (let idx = 0; idx < targets.length; idx += 1) {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const bx = btnArea.x + col * (btnW + gapX);
    const by = btnArea.y + row * (btnH + gapY);
    if (by + btnH > btnArea.y + btnArea.h + 0.05) break;

    const link = { slide: targets[idx].slide };
    slide.addShape("roundRect", {
      x: bx,
      y: by,
      w: btnW,
      h: btnH,
      fill: { color: "F8FAFC" },
      line: { color: STORY.soft, width: 1 },
      shadow: { type: "outer", color: "000000", opacity: 0.10, blur: 8, offset: 1, angle: 45 },
      hyperlink: link
    });
    slide.addShape("ellipse", {
      x: bx + 0.12,
      y: by + 0.14,
      w: 0.28,
      h: 0.28,
      fill: { color: STORY.accent, transparency: 5 },
      line: { color: STORY.accent, transparency: 20 },
      hyperlink: link
    });
    slide.addText(truncateText(targets[idx].unitId, 6), {
      x: bx + 0.12,
      y: by + 0.15,
      w: 0.28,
      h: 0.26,
      align: "center",
      valign: "middle",
      fontFace: "Calibri",
      fontSize: 10,
      bold: true,
      color: STORY.card,
      hyperlink: link
    });
    slide.addText(truncateText(targets[idx].title, 44), {
      x: bx + 0.46,
      y: by + 0.12,
      w: btnW - 0.56,
      h: btnH - 0.22,
      fontFace: "Calibri",
      fontSize: 12,
      bold: true,
      color: STORY.ink,
      valign: "top",
      hyperlink: link
    });
    slide.addText("Abrir", {
      x: bx + btnW - 0.9,
      y: by + btnH - 0.26,
      w: 0.8,
      h: 0.2,
      fontFace: "Calibri",
      fontSize: 10,
      color: STORY.muted,
      align: "right",
      hyperlink: link
    });
  }

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
    if (visual.watermarkLabel) {
      addVisualWatermark(slide, { x: 7.2, y: 0.9, w: 5.38, h: 5.7, label: visual.watermarkLabel });
    }
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

  addStoryFooterNav(slide, links);

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

function addPopupSlide(pptx: PptxGenJS, params: {
  courseTitle: string;
  unit: CourseUnit;
  popup: StoryPopupSpec;
  mainSlide: number;
  links: { menuSlide: number; backSlide?: number; nextSlide?: number };
  visual: ResolvedVisual | null;
  notes: string;
}) {
  const slide = pptx.addSlide();

  if (params.visual?.imagePath) {
    slide.background = { path: params.visual.imagePath };
  } else {
    slide.background = { color: STORY.bg };
  }

  // Dark overlay so popup content is readable over the background image.
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 13.33,
    h: 7.5,
    fill: { color: STORY.ink, transparency: 35 },
    line: { color: STORY.ink, transparency: 100 }
  });

  addStoryTopBar(slide, { left: `${params.unit.unit_id} - ${params.unit.title}`, right: "POPUP" });

  const closeLink = { slide: params.mainSlide };

  slide.addShape("roundRect", {
    x: 1.15,
    y: 1.15,
    w: 11.05,
    h: 5.55,
    fill: { color: STORY.card, transparency: 0 },
    line: { color: STORY.soft, width: 1 },
    shadow: { type: "outer", color: "000000", opacity: 0.16, blur: 16, offset: 3, angle: 45 }
  });

  slide.addShape("rect", {
    x: 1.15,
    y: 1.15,
    w: 11.05,
    h: 0.16,
    fill: { color: STORY.accent, transparency: 10 },
    line: { color: STORY.accent, transparency: 100 }
  });

  slide.addText(truncateText(params.popup.title, 80), {
    x: 1.55,
    y: 1.45,
    w: 9.2,
    h: 0.45,
    fontFace: "Calibri",
    fontSize: 24,
    bold: true,
    color: STORY.ink
  });

  slide.addText(params.popup.body?.trim() ? truncateText(params.popup.body, 800) : "(Contenido emergente)", {
    x: 1.55,
    y: 2.05,
    w: 10.65,
    h: 4.25,
    fontFace: "Calibri",
    fontSize: 14,
    color: STORY.muted,
    valign: "top"
  });

  slide.addShape("roundRect", {
    x: 10.55,
    y: 1.43,
    w: 1.5,
    h: 0.42,
    fill: { color: STORY.accent },
    hyperlink: closeLink
  });
  slide.addText("Cerrar", {
    x: 10.55,
    y: 1.46,
    w: 1.5,
    h: 0.36,
    align: "center",
    valign: "middle",
    fontFace: "Calibri",
    fontSize: 12,
    bold: true,
    color: STORY.card,
    hyperlink: closeLink
  });

  if (params.visual?.watermarkLabel) {
    addVisualWatermark(slide, { x: 0.3, y: 0.2, w: 12.7, h: 7.1, label: params.visual.watermarkLabel });
  }

  addStoryFooterNav(slide, {
    menuSlide: params.links.menuSlide,
    backSlide: params.mainSlide,
    nextSlide: params.mainSlide
  });

  slide.addNotes(params.notes);
}

async function resolveVisualWithFallback(params: {
  courseName: string;
  primaryQuery: string;
  topic: string;
}): Promise<ResolvedVisual | null> {
  const queries = [
    params.primaryQuery.trim(),
    `${params.primaryQuery.trim()} vector estilo freepik`,
    `${params.topic.trim()} ilustracion educativa`,
    "educacion digital ilustracion moderna"
  ].filter(Boolean);

  for (const query of queries) {
    const visual = await resolveStoryboardVisual({
      courseName: params.courseName,
      term: query,
      preferHorizontal: true
    });
    if (visual) {
      return visual;
    }
  }

  return null;
}

async function resolveIconWithFallback(params: {
  courseName: string;
  primaryQuery: string;
  topic: string;
}): Promise<ResolvedVisual | null> {
  const queries = [
    params.primaryQuery.trim(),
    `${params.topic.trim()} icono lineal`,
    `${params.topic.trim()} icon vector`,
    "educacion iconos lineales"
  ].filter(Boolean);

  for (const query of queries) {
    const visual = await resolveStoryboardVisual({
      courseName: params.courseName,
      term: query,
      preferHorizontal: false
    });
    if (visual) {
      return visual;
    }
  }

  return null;
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
  const coverVisual = await resolveStoryboardVisual({ courseName, term: coverQuery, preferHorizontal: true });

  const coverSlideNo = 1;
  const menuSlideNo = 2;
  const mainSlideStart = 3;
  const unitCount = output.course_structure.length;
  const mainSlideNos = output.course_structure.map((_, idx) => mainSlideStart + idx);

  // Pre-parse visual specs so we can allocate popup slide numbers deterministically.
  const unitSpecs = output.course_structure.map((unit) => {
    const visualSpecRaw = pickResourceByType(unit, "visual_spec");
    const visualSpec = parseVisualSpec(visualSpecRaw, { title: unit.title, content: unit.content_outline });
    const visualQuery = pickResourceByType(unit, "imagen_query")?.trim() || `${unit.title} ilustracion plana`;
    const iconQuery = pickResourceByType(unit, "icon_query")?.trim() || `${unit.title} icono lineal educativo`;
    const infographicTechRaw = pickResourceByType(unit, "infografia_tecnica");
    const infographicTech = parseInfographicTechnicalSpec(infographicTechRaw, {
      topic: unit.title,
      visual: visualSpec
    });
    return { unit, visualSpecRaw, visualSpec, visualQuery, iconQuery, infographicTechRaw, infographicTech };
  });

  const popupStart = mainSlideStart + unitCount;
  let nextPopupSlide = popupStart;
  const popupSlideNosByUnit: number[][] = unitSpecs.map((spec) => {
    const popups = spec.visualSpec.popups.slice(0, 3);
    const out: number[] = [];
    for (let i = 0; i < popups.length; i += 1) out.push(nextPopupSlide++);
    return out;
  });

  addStoryboardCover(pptx, output, coverVisual, menuSlideNo);
  addStoryboardMenu(
    pptx,
    output,
    coverVisual,
    output.course_structure.map((unit, idx) => ({
      unitId: unit.unit_id,
      title: unit.title,
      slide: mainSlideNos[idx] ?? menuSlideNo
    })),
    {
      menuSlide: menuSlideNo,
      backSlide: coverSlideNo,
      nextSlide: mainSlideNos[0] ?? menuSlideNo
    }
  );

  // Main slides (one per unit)
  const resolvedVisuals: Array<ResolvedVisual | null> = [];
  const resolvedIcons: Array<ResolvedVisual | null> = [];
  for (let idx = 0; idx < unitSpecs.length; idx += 1) {
    const { unit, visualQuery, iconQuery, visualSpec, visualSpecRaw, infographicTech, infographicTechRaw } = unitSpecs[idx];
    const master = masterForUnit(idx);
    const audioScript = pickResourceByType(unit, "guion_audio");
    const build = pickResourceByType(unit, "notas_construccion");
    const resources = otherResources(unit).map(formatResource);
    const interactivity = buildInteractivityLines(unit);

    const visual = await resolveVisualWithFallback({
      courseName,
      primaryQuery: visualQuery,
      topic: unit.title
    });
    resolvedVisuals.push(visual);
    const iconVisual = await resolveIconWithFallback({
      courseName,
      primaryQuery: iconQuery,
      topic: unit.title
    });
    resolvedIcons.push(iconVisual);

    const slide = pptx.addSlide();
    addStoryBackground(slide);
    const progress = `${idx + 1}/${unitCount}`;
    addStoryTopBar(slide, {
      left: `${unit.unit_id} - ${unit.title} | Plantilla ${master.name}`,
      right: `${unit.unit_id} ${progress}`
    });

    // Left content card
    slide.addShape("roundRect", {
      x: 0.55,
      y: 0.75,
      w: 6.95,
      h: 5.98,
      fill: { color: STORY.card },
      line: { color: STORY.soft, width: 1 }
    });

    slide.addText(truncateText(unit.title, 60), {
      x: 1.45,
      y: 0.94,
      w: 5.8,
      h: 0.35,
      fontFace: "Calibri",
      fontSize: 18,
      bold: true,
      color: STORY.ink
    });
    addIconMarker(slide, { x: 0.88, y: 0.88, size: 0.5, icon: iconVisual });

    slide.addText(truncateText(unit.purpose, 140), {
      x: 0.85,
      y: 1.28,
      w: 6.4,
      h: 0.55,
      fontFace: "Calibri",
      fontSize: 10,
      color: STORY.muted
    });

    slide.addText("En pantalla (estudiante)", {
      x: 0.85,
      y: 1.88,
      w: 6.4,
      h: 0.25,
      fontFace: "Calibri",
      fontSize: 12,
      bold: true,
      color: master.accent
    });

    renderNarrativeText(slide, { x: 0.85, y: 2.15, w: 6.4, h: 3.3 }, unit.content_outline);

    // Interactivity card
    slide.addShape("roundRect", {
      x: 0.85,
      y: 5.58,
      w: 6.4,
      h: 1.06,
      fill: { color: master.panelTint },
      line: { color: master.panelBorder, width: 1 }
    });
    slide.addText("Interactividad", {
      x: 1.05,
      y: 5.68,
      w: 6.0,
      h: 0.25,
      fontFace: "Calibri",
      fontSize: 11,
      bold: true,
      color: master.accent
    });
    const interLines = clampLines(interactivity, 3, 110);
    slide.addText(interLines.join("\n"), {
      x: 1.05,
      y: 5.92,
      w: 6.0,
      h: 0.66,
      fontFace: "Calibri",
      fontSize: 10,
      color: STORY.muted,
      valign: "top",
      bullet: true
    });

    // Right visual card (image + technical infographic spec)
    slide.addShape("roundRect", {
      x: 7.65,
      y: 0.75,
      w: 4.98,
      h: 5.98,
      fill: { color: STORY.card },
      line: { color: STORY.soft, width: 1 }
    });

    const mediaArea = { x: 7.72, y: 0.83, w: 4.84, h: 3.15 };
    const visualArea = { x: 7.72, y: 4.05, w: 4.84, h: 2.6 };
    const visualMode = resolveVisualMode(visualSpec, infographicTech, unit.content_outline);

    if (visual?.imagePath) {
      slide.addImage({
        path: visual.imagePath,
        x: mediaArea.x,
        y: mediaArea.y,
        w: mediaArea.w,
        h: mediaArea.h,
        sizing: { type: "cover", w: mediaArea.w, h: mediaArea.h }
      });
      if (visual.watermarkLabel) {
        addVisualWatermark(slide, {
          x: mediaArea.x,
          y: mediaArea.y,
          w: mediaArea.w,
          h: mediaArea.h,
          label: visual.watermarkLabel
        });
      }
    } else {
      slide.addShape("rect", {
        x: mediaArea.x,
        y: mediaArea.y,
        w: mediaArea.w,
        h: mediaArea.h,
        fill: { color: STORY.soft }
      });
      slide.addShape("ellipse", {
        x: 9.25,
        y: 1.35,
        w: 1.65,
        h: 1.65,
        fill: { color: master.accent2, transparency: 80 },
        line: { color: master.accent2, transparency: 100 }
      });
      slide.addShape("ellipse", {
        x: 8.35,
        y: 2.25,
        w: 2.15,
        h: 2.15,
        fill: { color: master.accent, transparency: 88 },
        line: { color: master.accent, transparency: 100 }
      });
    }

    slide.addShape("roundRect", {
      x: visualArea.x,
      y: visualArea.y,
      w: visualArea.w,
      h: visualArea.h,
      fill: { color: "FFFFFF" },
      line: { color: STORY.soft, width: 1 }
    });
    slide.addText("Componente visual", {
      x: visualArea.x + 0.16,
      y: visualArea.y + 0.1,
      w: visualArea.w - 0.32,
      h: 0.2,
      fontFace: "Calibri",
      fontSize: 11,
      bold: true,
      color: STORY.ink
    });

    const canvasArea = {
      x: visualArea.x + 0.14,
      y: visualArea.y + 0.34,
      w: visualArea.w - 0.28,
      h: visualArea.h - 0.48
    };

    if (visualMode === "comparison") {
      renderComparison(slide, canvasArea, visualSpec.items);
    } else if (visualMode === "activity") {
      renderActivityCanvas(slide, canvasArea, interactivity, visualSpec.items);
    } else if (visualMode === "infographic") {
      renderInfographic(slide, canvasArea, visualSpec);
      if (infographicTech.requiresInfographic) {
        const miniMermaidArea = {
          x: canvasArea.x + canvasArea.w - 1.62,
          y: canvasArea.y + canvasArea.h - 0.86,
          w: 1.48,
          h: 0.72
        };
        renderMermaidMiniDiagram(slide, miniMermaidArea, infographicTech);
        slide.addText(`Metáfora visual: ${truncateText(infographicTech.visualMetaphor, 78)}`, {
          x: visualArea.x + 0.18,
          y: visualArea.y + visualArea.h - 0.22,
          w: visualArea.w - 1.95,
          h: 0.16,
          fontFace: "Calibri",
          fontSize: 8,
          color: STORY.muted
        });
      }
    } else {
      const narrative = visualSpec.items.map((item) => `${item.title}${item.body ? `: ${item.body}` : ""}`);
      renderNarrativeText(slide, canvasArea, narrative.length ? narrative : unit.content_outline);
    }

    slide.addText("Guía técnica completa en Notas del orador", {
      x: visualArea.x + 0.16,
      y: visualArea.y + visualArea.h - 0.2,
      w: visualArea.w - 0.8,
      h: 0.18,
      fontFace: "Calibri",
      fontSize: 8,
      color: STORY.muted
    });
    addIconMarker(slide, { x: visualArea.x + visualArea.w - 0.54, y: visualArea.y + 0.06, size: 0.36, icon: iconVisual });

    // Mock UI buttons/hotspots over the visual (Genially-style).
    if (visualSpec.buttons.length) {
      const popupSlideNos = popupSlideNosByUnit[idx] ?? [];
      const popupByKey = new Map<string, number>();
      for (let p = 0; p < visualSpec.popups.length && p < popupSlideNos.length; p += 1) {
        popupByKey.set(normalizeKey(visualSpec.popups[p].button), popupSlideNos[p]);
      }

      const overlayButtons = visualSpec.buttons.slice(0, 3).map((label) => ({
        label,
        slide: popupByKey.get(normalizeKey(label))
      }));
      addOverlayButtons(slide, { x: 7.92, y: 3.56, w: 4.4 }, overlayButtons);
    }

    // Footer: navigation + resource chips
    const backSlide = idx === 0 ? menuSlideNo : (mainSlideNos[idx - 1] ?? menuSlideNo);
    const nextSlide = idx === unitCount - 1 ? menuSlideNo : (mainSlideNos[idx + 1] ?? menuSlideNo);
    addStoryFooterNav(slide, { menuSlide: menuSlideNo, backSlide, nextSlide });
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
      iconQuery,
      iconAttribution: iconVisual?.attributionLines ?? [],
      visualSpecRaw,
      infographicTechRaw,
      extraResources: resources
    });
    slide.addNotes(notes);
  }

  // Popup slides (simulated interactivity)
  for (let idx = 0; idx < unitSpecs.length; idx += 1) {
    const { unit, visualSpec, visualQuery, iconQuery, visualSpecRaw, infographicTechRaw } = unitSpecs[idx];
    const popups = visualSpec.popups.slice(0, 3);
    if (!popups.length) continue;

    const audioScript = pickResourceByType(unit, "guion_audio");
    const build = pickResourceByType(unit, "notas_construccion");
    const resources = otherResources(unit).map(formatResource);
    const interactivity = buildInteractivityLines(unit);

    const mainSlide = mainSlideNos[idx] ?? menuSlideNo;
    const visual = resolvedVisuals[idx] ?? null;
    const iconVisual = resolvedIcons[idx] ?? null;

    const baseNotes = buildNotes({
      courseTitle: output.project.title,
      unit,
      audioScript,
      buildNotes: build,
      studentText: unit.content_outline,
      interactivity,
      visualQuery,
      visualAttribution: visual?.attributionLines ?? [],
      iconQuery,
      iconAttribution: iconVisual?.attributionLines ?? [],
      visualSpecRaw,
      infographicTechRaw,
      extraResources: resources
    });

    for (let p = 0; p < popups.length; p += 1) {
      addPopupSlide(pptx, {
        courseTitle: output.project.title,
        unit,
        popup: popups[p],
        mainSlide,
        links: { menuSlide: menuSlideNo },
        visual,
        notes: `${baseNotes}\n\nPOPUP (${p + 1}/${popups.length}): ${popups[p].button}`
      });
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
  options?: { mode?: string; courseName?: string }
): Promise<Buffer> {
  const mode = (options?.mode ?? "full") as string;
  if (mode === "ova-storyboard") {
    return toPptxBufferStoryboard(output, { courseName: options?.courseName });
  }
  return toPptxBufferOverview(output);
}
