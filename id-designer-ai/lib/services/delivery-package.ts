import JSZip from "jszip";
import { toMarkdown } from "@/lib/services/markdown-export";
import { toPptxBuffer } from "@/lib/services/pptx-export";
import type { QualityReport } from "@/lib/validators/quality";
import type { InstructionalDesignOutput } from "@/lib/validators/output-schema";

export interface DeliveryArtifact {
  path: string;
  data: Buffer;
  contentType: string;
}

interface BuildDeliveryPackageInput {
  baseName: string;
  courseName: string;
  versionNumber: number;
  output: InstructionalDesignOutput;
  qualityReport: QualityReport;
  mode?: string;
  model?: string;
  createdAtIso: string;
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function pickResourceTitle(
  resources: InstructionalDesignOutput["course_structure"][number]["resources"],
  type: string
): string {
  const wanted = normalizeKey(type);
  const item = resources.find((resource) => normalizeKey(resource.type || "") === wanted);
  const value = item?.title?.trim();
  return value?.length ? value : "N/D";
}

function toBuffer(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

function toAudioScriptMarkdown(output: InstructionalDesignOutput): string {
  const lines: string[] = [];
  lines.push(`# Guion de audio - ${output.project.title}`);
  lines.push("");

  for (const unit of output.course_structure) {
    const audio = pickResourceTitle(unit.resources, "guion_audio");
    const buildNotes = pickResourceTitle(unit.resources, "notas_construccion");
    lines.push(`## ${unit.unit_id} - ${unit.title}`);
    lines.push("");
    lines.push(`- **Duración estimada:** ${unit.duration_minutes} min`);
    lines.push(`- **Objetivos vinculados:** ${unit.outcomes.join(", ")}`);
    lines.push("");
    lines.push("### Texto en pantalla (estudiante)");
    for (const content of unit.content_outline) {
      lines.push(`- ${content}`);
    }
    lines.push("");
    lines.push("### Guion de audio");
    lines.push(audio);
    lines.push("");
    lines.push("### Interactividad esperada");
    for (const activity of unit.learning_activities) {
      lines.push(`- ${activity.type}: ${activity.description} (${activity.modality}, ${activity.estimated_minutes} min)`);
    }
    for (const assessment of unit.assessment) {
      lines.push(`- Check (${assessment.type}): ${assessment.description} | Evidencia: ${assessment.evidence}`);
    }
    lines.push("");
    lines.push("### Notas de construcción");
    lines.push(buildNotes);
    lines.push("");
  }

  return lines.join("\n");
}

function toVisualPolicyMarkdown(output: InstructionalDesignOutput): string {
  const lines: string[] = [];
  lines.push(`# Política de recursos visuales - ${output.project.title}`);
  lines.push("");
  lines.push("## Criterios de uso");
  lines.push("- Priorizar recursos con licencias abiertas o claramente atribuibles.");
  lines.push("- Si la licencia es ambigua o restrictiva, mantener marca de agua y pedir sustitución.");
  lines.push("- Registrar autor, fuente y licencia en notas del orador y en repositorio de assets.");
  lines.push("- Validar uso comercial/educativo con el área legal antes de publicar.");
  lines.push("");

  lines.push("## Consultas visuales por pantalla");
  for (const unit of output.course_structure) {
    const query = pickResourceTitle(unit.resources, "imagen_query");
    const infographicTech = pickResourceTitle(unit.resources, "infografia_tecnica");
    lines.push(`### ${unit.unit_id} - ${unit.title}`);
    lines.push(`- Query sugerida: ${query}`);
    lines.push(`- Infografía técnica: ${infographicTech}`);
    lines.push("");
  }

  lines.push("## Aprobación editorial");
  lines.push("- [ ] Licencias revisadas y aprobadas.");
  lines.push("- [ ] Atribuciones completas en notas/origen.");
  lines.push("- [ ] Recurso visual final reemplaza previsualizaciones.");
  lines.push("");

  return lines.join("\n");
}

function toQaChecklistMarkdown(
  output: InstructionalDesignOutput,
  qualityReport: QualityReport,
  params: { mode?: string; model?: string }
): string {
  const lines: string[] = [];
  lines.push(`# Checklist QA - ${output.project.title}`);
  lines.push("");
  lines.push(`- **Modelo IA:** ${params.model ?? "N/D"}`);
  lines.push(`- **Modo de generación:** ${params.mode ?? "N/D"}`);
  lines.push(`- **Puntaje automático:** ${qualityReport.overallScore}/100`);
  lines.push("");

  lines.push("## Resultados automáticos");
  for (const item of qualityReport.items) {
    lines.push(`- [${item.status === "ok" ? "x" : " "}] **${item.label}** (${item.status})`);
    lines.push(`  - ${item.detail}`);
  }
  lines.push("");

  lines.push("## Hallazgos automáticos");
  if (qualityReport.issues.length === 0) {
    lines.push("- Sin hallazgos críticos.");
  } else {
    for (const issue of qualityReport.issues) {
      lines.push(`- ${issue}`);
    }
  }
  lines.push("");

  lines.push("## Checklist editorial");
  const editorial = qualityReport.editorialChecklist ?? [];
  if (editorial.length === 0) {
    lines.push("- [ ] Validación editorial general.");
  } else {
    for (const item of editorial) {
      lines.push(`- [ ] ${item.label}: ${item.detail}`);
    }
  }
  lines.push("");

  lines.push("## Aprobación");
  lines.push("- [ ] Aprobado por diseño instruccional.");
  lines.push("- [ ] Aprobado por experto temático.");
  lines.push("- [ ] Aprobado por QA técnico.");
  lines.push("- [ ] Listo para publicación en LMS/Genially.");
  lines.push("");

  return lines.join("\n");
}

export async function buildDeliveryPackage(
  input: BuildDeliveryPackageInput
): Promise<{ zipBuffer: Buffer; artifacts: DeliveryArtifact[] }> {
  const markdown = toMarkdown(input.output);
  const audioMarkdown = toAudioScriptMarkdown(input.output);
  const qualityMarkdown = toQaChecklistMarkdown(input.output, input.qualityReport, {
    mode: input.mode,
    model: input.model
  });
  const visualPolicy = toVisualPolicyMarkdown(input.output);
  const pptx = await toPptxBuffer(input.output, {
    mode: input.mode,
    courseName: input.courseName
  });

  const manifest = {
    project: input.output.project.title,
    version: input.versionNumber,
    generatedAt: input.createdAtIso,
    mode: input.mode ?? "full",
    model: input.model ?? "N/D",
    files: [
      `${input.baseName}.json`,
      `${input.baseName}.md`,
      `${input.baseName}.pptx`,
      `${input.baseName}-guion-audio.md`,
      `${input.baseName}-checklist-qc.md`,
      `${input.baseName}-visuales-licencias.md`
    ]
  };

  const root = `${input.baseName}`;
  const artifacts: DeliveryArtifact[] = [
    {
      path: `${root}/${input.baseName}.json`,
      data: toBuffer(JSON.stringify(input.output, null, 2)),
      contentType: "application/json; charset=utf-8"
    },
    {
      path: `${root}/${input.baseName}.md`,
      data: toBuffer(markdown),
      contentType: "text/markdown; charset=utf-8"
    },
    {
      path: `${root}/${input.baseName}.pptx`,
      data: pptx,
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    },
    {
      path: `${root}/${input.baseName}-guion-audio.md`,
      data: toBuffer(audioMarkdown),
      contentType: "text/markdown; charset=utf-8"
    },
    {
      path: `${root}/${input.baseName}-checklist-qc.md`,
      data: toBuffer(qualityMarkdown),
      contentType: "text/markdown; charset=utf-8"
    },
    {
      path: `${root}/${input.baseName}-visuales-licencias.md`,
      data: toBuffer(visualPolicy),
      contentType: "text/markdown; charset=utf-8"
    },
    {
      path: `${root}/${input.baseName}-manifest.json`,
      data: toBuffer(JSON.stringify(manifest, null, 2)),
      contentType: "application/json; charset=utf-8"
    }
  ];

  const zip = new JSZip();
  for (const artifact of artifacts) {
    zip.file(artifact.path, artifact.data);
  }

  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });

  return {
    zipBuffer,
    artifacts
  };
}
