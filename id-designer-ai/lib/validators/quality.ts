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
}

function average(numbers: number[]): number {
  if (numbers.length === 0) {
    return 0;
  }
  return numbers.reduce((acc, value) => acc + value, 0) / numbers.length;
}

export function evaluateInstructionalQuality(
  output: InstructionalDesignOutput,
  expectedDurationHours: number
): QualityReport {
  const issues: string[] = [];
  const fixSuggestions: string[] = [];
  const items: QualityChecklistItem[] = [];

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

  return {
    overallScore: scoreFromItems,
    items,
    issues,
    fixSuggestions
  };
}
