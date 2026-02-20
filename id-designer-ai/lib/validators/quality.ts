import { InstructionalDesignOutput } from "@/lib/validators/output-schema";

export type ChecklistStatus = "ok" | "warning" | "error";

export interface QualityChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  detail: string;
}

export interface QualityReport {
  overallScore: number;
  items: QualityChecklistItem[];
  issues: string[];
  fixSuggestions: string[];
  editorialChecklist?: QualityChecklistItem[];
}

type GenerationMode = "full" | "evaluation-only" | "ova-storyboard";

function average(numbers: number[]): number {
  if (numbers.length === 0) {
    return 0;
  }
  return numbers.reduce((acc, value) => acc + value, 0) / numbers.length;
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function detectStoryboardMode(output: InstructionalDesignOutput, mode?: GenerationMode): boolean {
  if (mode === "ova-storyboard") {
    return true;
  }

  const storyboardTypes = new Set([
    "guion_audio",
    "notas_construccion",
    "imagen_query",
    "icon_query",
    "visual_spec",
    "infografia_tecnica"
  ]);

  return output.course_structure.some((unit) =>
    unit.resources.some((resource) => storyboardTypes.has(normalizeKey(resource.type || "")))
  );
}

function hasResource(unit: InstructionalDesignOutput["course_structure"][number], type: string): boolean {
  const wanted = normalizeKey(type);
  return unit.resources.some((resource) => {
    const sameType = normalizeKey(resource.type || "") === wanted;
    return sameType && (resource.title?.trim()?.length ?? 0) > 0;
  });
}

export function evaluateInstructionalQuality(
  output: InstructionalDesignOutput,
  expectedDurationHours: number,
  options?: { mode?: GenerationMode }
): QualityReport {
  const issues: string[] = [];
  const fixSuggestions: string[] = [];
  const items: QualityChecklistItem[] = [];
  const editorialChecklist: QualityChecklistItem[] = [];

  const unitDurationMinutes = output.course_structure.reduce((acc, unit) => acc + unit.duration_minutes, 0);
  const expectedMinutes = expectedDurationHours * 60;
  const durationDrift = Math.abs(unitDurationMinutes - expectedMinutes) / Math.max(expectedMinutes, 1);

  if (durationDrift <= 0.2) {
    items.push({
      id: "duration_consistency",
      label: "Consistencia de tiempo total",
      status: "ok",
      detail: `La duración acumulada (${unitDurationMinutes} min) está alineada al objetivo (${expectedMinutes} min).`
    });
  } else {
    const detail = `La duración acumulada (${unitDurationMinutes} min) se desvía más del 20% frente al objetivo (${expectedMinutes} min).`;
    issues.push(detail);
    fixSuggestions.push("Reasigna minutos por unidad para mantener la carga total prevista.");
    items.push({
      id: "duration_consistency",
      label: "Consistencia de tiempo total",
      status: "warning",
      detail
    });
  }

  const overloadedUnits = output.course_structure.filter((unit) => unit.duration_minutes > 180);
  if (overloadedUnits.length === 0) {
    items.push({
      id: "cognitive_load",
      label: "Carga cognitiva",
      status: "ok",
      detail: "No hay unidades con duración excesiva."
    });
  } else {
    const detail = `Se detectaron unidades con más de 180 minutos: ${overloadedUnits.map((u) => u.unit_id).join(", ")}.`;
    issues.push(detail);
    fixSuggestions.push("Divide unidades extensas en sesiones más cortas o agrega pausas de práctica.");
    items.push({
      id: "cognitive_load",
      label: "Carga cognitiva",
      status: "warning",
      detail
    });
  }

  const outcomes = output.learning_outcomes.map((outcome) => outcome.id);
  for (const outcomeId of outcomes) {
    const appearsInUnit = output.course_structure.some((unit) => unit.outcomes.includes(outcomeId));
    const matrixRow = output.alignment_matrix.find((row) => row.outcome_id === outcomeId);
    const hasActivities = Boolean(matrixRow && matrixRow.activities.length > 0);
    const hasAssessments = Boolean(matrixRow && matrixRow.assessments.length > 0);

    const missing: string[] = [];
    if (!appearsInUnit) {
      missing.push("unidad");
    }
    if (!hasActivities) {
      missing.push("actividad");
    }
    if (!hasAssessments) {
      missing.push("evaluación");
    }

    if (missing.length === 0) {
      items.push({
        id: `alignment_${outcomeId}`,
        label: `Alineación de ${outcomeId}`,
        status: "ok",
        detail: `${outcomeId} aparece en unidad, actividad y evaluación.`
      });
    } else {
      const detail = `${outcomeId} no está cubierto en: ${missing.join(", ")}.`;
      issues.push(detail);
      fixSuggestions.push(`Ajusta la matriz de alineación para que ${outcomeId} tenga trazabilidad completa.`);
      items.push({
        id: `alignment_${outcomeId}`,
        label: `Alineación de ${outcomeId}`,
        status: "error",
        detail
      });
    }
  }

  const matrixScore = average(output.alignment_matrix.map((row) => row.alignment_score_0_100));
  if (matrixScore >= 75) {
    items.push({
      id: "matrix_score",
      label: "Puntaje de alineación",
      status: "ok",
      detail: `Promedio de la matriz: ${matrixScore.toFixed(1)}/100.`
    });
  } else {
    const detail = `Promedio de la matriz por debajo del umbral recomendado: ${matrixScore.toFixed(1)}/100.`;
    issues.push(detail);
    fixSuggestions.push("Fortalece la relación objetivo-actividad-evaluación en los outcomes con menor puntaje.");
    items.push({
      id: "matrix_score",
      label: "Puntaje de alineación",
      status: "warning",
      detail
    });
  }

  const isStoryboard = detectStoryboardMode(output, options?.mode);
  if (isStoryboard) {
    const requiredStoryboardTypes = [
      "guion_audio",
      "notas_construccion",
      "imagen_query",
      "icon_query",
      "visual_spec",
      "infografia_tecnica"
    ];

    const missingByUnit: string[] = [];
    const overloadedTextUnits: string[] = [];
    for (const unit of output.course_structure) {
      const missing = requiredStoryboardTypes.filter((type) => !hasResource(unit, type));
      if (missing.length > 0) {
        missingByUnit.push(`${unit.unit_id} (${missing.join(", ")})`);
      }

      const visibleChars = unit.content_outline.join(" ").trim().length;
      if (visibleChars > 900) {
        overloadedTextUnits.push(`${unit.unit_id} (${visibleChars} caracteres)`);
      }
    }

    if (missingByUnit.length === 0) {
      items.push({
        id: "storyboard_completeness",
        label: "Completitud de storyboard técnico",
        status: "ok",
        detail: "Todas las pantallas incluyen audio, construcción, visual, query e infografía técnica."
      });
    } else {
      const detail = `Pantallas incompletas: ${missingByUnit.join("; ")}.`;
      issues.push(detail);
      fixSuggestions.push(
        "Regenera o edita las pantallas incompletas para incluir guion de audio, notas de construcción, imagen_query, icon_query, visual_spec e infografia_tecnica."
      );
      items.push({
        id: "storyboard_completeness",
        label: "Completitud de storyboard técnico",
        status: "error",
        detail
      });
    }

    if (overloadedTextUnits.length === 0) {
      items.push({
        id: "storyboard_text_density",
        label: "Densidad de texto por pantalla",
        status: "ok",
        detail: "La cantidad de texto visible por pantalla se mantiene en un rango recomendado."
      });
    } else {
      const detail = `Pantallas con exceso de texto visible: ${overloadedTextUnits.join("; ")}.`;
      issues.push(detail);
      fixSuggestions.push("Reduce texto por pantalla y traslada detalle a audio, popups o notas del orador.");
      items.push({
        id: "storyboard_text_density",
        label: "Densidad de texto por pantalla",
        status: "warning",
        detail
      });
    }
  }

  const scoreFromItems = Math.round(
    average(
      items.map((item) => {
        if (item.status === "ok") {
          return 100;
        }
        if (item.status === "warning") {
          return 70;
        }
        return 35;
      })
    )
  );

  const baseEditorial = [
    {
      id: "editorial_accuracy",
      label: "Revisión disciplinar (SME)",
      detail: "Validar precisión conceptual, terminología y consistencia con el material base."
    },
    {
      id: "editorial_accessibility",
      label: "Revisión de accesibilidad",
      detail: "Verificar contraste, legibilidad, subtítulos/transcripción y redacción inclusiva."
    },
    {
      id: "editorial_licensing",
      label: "Revisión legal de recursos visuales",
      detail: "Confirmar licencias y atribuciones de imágenes antes de publicación."
    }
  ];

  const storyboardEditorial = isStoryboard
    ? [
        {
          id: "editorial_audio_timing",
          label: "Sincronía audio-pantalla",
          detail: "Asegurar que guion de audio, texto visible e interactividad estén sincronizados."
        },
        {
          id: "editorial_nav_testing",
          label: "Prueba funcional de navegación",
          detail: "Probar menú, atrás, siguiente, botones y popups en secuencia completa."
        },
        {
          id: "editorial_release_package",
          label: "Paquete final de entrega",
          detail: "Confirmar JSON + Markdown + PPTX + guion_audio + checklist_qc antes de entregar."
        }
      ]
    : [];

  for (const item of [...baseEditorial, ...storyboardEditorial]) {
    editorialChecklist.push({
      id: item.id,
      label: item.label,
      status: "warning",
      detail: item.detail
    });
  }

  return {
    overallScore: scoreFromItems,
    items,
    issues,
    fixSuggestions,
    editorialChecklist
  };
}
