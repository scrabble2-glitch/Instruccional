import { InstructionalDesignOutput } from "@/lib/validators/output-schema";

export function toMarkdown(output: InstructionalDesignOutput): string {
  const lines: string[] = [];

  lines.push(`# ${output.project.title}`);
  lines.push("");
  lines.push(`- **Audiencia:** ${output.project.audience}`);
  lines.push(`- **Nivel:** ${output.project.level}`);
  lines.push(`- **Duración (horas):** ${output.project.duration_hours}`);
  lines.push(`- **Modalidad:** ${output.project.modality}`);
  lines.push(`- **Modelo instruccional:** ${output.instructional_model.approach}`);
  lines.push("");

  lines.push("## Resultados de aprendizaje");
  for (const lo of output.learning_outcomes) {
    lines.push(`- **${lo.id} (${lo.bloom_level})**: ${lo.statement}`);
  }
  lines.push("");

  lines.push("## Estructura del curso");
  for (const unit of output.course_structure) {
    lines.push(`### ${unit.unit_id} - ${unit.title}`);
    lines.push(`- **Propósito:** ${unit.purpose}`);
    lines.push(`- **Duración (min):** ${unit.duration_minutes}`);
    lines.push(`- **Outcomes:** ${unit.outcomes.join(", ")}`);
    lines.push("- **Contenidos:**");
    for (const content of unit.content_outline) {
      lines.push(`  - ${content}`);
    }
    lines.push("- **Actividades:**");
    for (const activity of unit.learning_activities) {
      lines.push(
        `  - (${activity.type}, ${activity.modality}, ${activity.estimated_minutes} min) ${activity.description}`
      );
    }
    lines.push("- **Evaluación:**");
    for (const assessment of unit.assessment) {
      lines.push(`  - **${assessment.type}**: ${assessment.description}`);
      lines.push(`    - Evidencia: ${assessment.evidence}`);
      lines.push("    - Rúbrica:");
      for (const rubric of assessment.rubric) {
        lines.push(`      - ${rubric.criterion}: ${rubric.levels.join(" | ")}`);
      }
    }
    lines.push("- **Recursos:**");
    for (const resource of unit.resources) {
      lines.push(`  - ${resource.type}: ${resource.title} (${resource.link_optional || "placeholder"})`);
    }
    lines.push("");
  }

  lines.push("## Matriz de alineación");
  for (const row of output.alignment_matrix) {
    lines.push(`- **${row.outcome_id}**`);
    lines.push(`  - Actividades: ${row.activities.join(", ") || "N/D"}`);
    lines.push(`  - Evaluaciones: ${row.assessments.join(", ") || "N/D"}`);
    lines.push(`  - Score: ${row.alignment_score_0_100}`);
    lines.push(`  - Issues: ${row.issues.join("; ") || "Sin issues"}`);
    lines.push(`  - Fix: ${row.fix_suggestions.join("; ") || "Sin sugerencias"}`);
  }
  lines.push("");

  lines.push("## Notas de producción");
  lines.push("### LMS");
  for (const note of output.production_notes.for_lms) {
    lines.push(`- ${note}`);
  }
  lines.push("### Accesibilidad");
  for (const note of output.production_notes.accessibility) {
    lines.push(`- ${note}`);
  }
  lines.push("### Riesgos");
  for (const note of output.production_notes.risks) {
    lines.push(`- ${note}`);
  }

  lines.push("");
  return lines.join("\n");
}
