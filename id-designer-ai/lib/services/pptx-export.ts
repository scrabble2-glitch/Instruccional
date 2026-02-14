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
    return key !== "guion_audio" && key !== "notas_construccion" && key !== "imagen_query" && key !== "visual_spec";
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
  visualSpecRaw: string | null;
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

  lines.push("VISUAL SPEC (infografia / UI):");
  lines.push(params.visualSpecRaw?.trim() ? params.visualSpecRaw.trim() : "(No provisto por IA. Regenera para completar.)");
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
  const base: StoryVisualSpec = { layout: "bullets", items: [], buttons: [], popups: [] };
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
    const iconShapes = ["hexagon", "gear6", "lightningBolt", "diamond"] as const;
    const shadow = { type: "outer", color: "000000", opacity: 0.12, blur: 10, offset: 2, angle: 45 } as const;

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
        shadow
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
    const shadow = { type: "outer", color: "000000", opacity: 0.12, blur: 10, offset: 2, angle: 45 } as const;
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
        shadow
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
        slide.addShape("downArrow", {
          x: x + w / 2 - 0.12,
          y: cy + cardH + 0.01,
          w: 0.24,
          h: 0.18,
          fill: { color: STORY.accent2, transparency: 35 },
          line: { color: STORY.accent2, transparency: 60 }
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
    return { unit, visualSpecRaw, visualSpec, visualQuery };
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
  for (let idx = 0; idx < unitSpecs.length; idx += 1) {
    const { unit, visualQuery, visualSpec, visualSpecRaw } = unitSpecs[idx];
    const audioScript = pickResourceByType(unit, "guion_audio");
    const build = pickResourceByType(unit, "notas_construccion");
    const resources = otherResources(unit).map(formatResource);
    const interactivity = buildInteractivityLines(unit);

    const visual = await resolveStoryboardVisual({ courseName, term: visualQuery, preferHorizontal: true });
    resolvedVisuals.push(visual);

    const slide = pptx.addSlide();
    addStoryBackground(slide);
    const progress = `${idx + 1}/${unitCount}`;
    addStoryTopBar(slide, { left: `${unit.unit_id} - ${unit.title}`, right: `${unit.unit_id} ${progress}` });

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

    renderInfographic(slide, { x: 1.0, y: 2.05, w: 5.8, h: 2.75 }, visualSpec);

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
    const interLines = clampLines(interactivity, 3, 110);
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
      if (visual.watermarkLabel) {
        addVisualWatermark(slide, { x: 7.2, y: 0.8, w: 5.38, h: 5.75, label: visual.watermarkLabel });
      }
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
      addOverlayButtons(slide, { x: 7.35, y: 6.18, w: 5.08 }, overlayButtons);
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
      visualSpecRaw,
      extraResources: resources
    });
    slide.addNotes(notes);
  }

  // Popup slides (simulated interactivity)
  for (let idx = 0; idx < unitSpecs.length; idx += 1) {
    const { unit, visualSpec, visualQuery, visualSpecRaw } = unitSpecs[idx];
    const popups = visualSpec.popups.slice(0, 3);
    if (!popups.length) continue;

    const audioScript = pickResourceByType(unit, "guion_audio");
    const build = pickResourceByType(unit, "notas_construccion");
    const resources = otherResources(unit).map(formatResource);
    const interactivity = buildInteractivityLines(unit);

    const mainSlide = mainSlideNos[idx] ?? menuSlideNo;
    const visual = resolvedVisuals[idx] ?? null;

    const baseNotes = buildNotes({
      courseTitle: output.project.title,
      unit,
      audioScript,
      buildNotes: build,
      studentText: unit.content_outline,
      interactivity,
      visualQuery,
      visualAttribution: visual?.attributionLines ?? [],
      visualSpecRaw,
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
